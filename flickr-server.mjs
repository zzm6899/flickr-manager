import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const preferredPort = Number(process.env.PORT || 8765);
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  console.error('PORT must be between 1 and 65535.');
  process.exit(1);
}
const address = '127.0.0.1';
const ports = process.env.PORT ? [preferredPort] : [preferredPort, 8766, 0];
let attempt = 0;
let host, origin;
const canRemember = process.platform === 'win32' && Boolean(process.env.LOCALAPPDATA && process.env.SystemRoot);
const validCredential = value => typeof value === 'string' && /^[!-~]{1,256}$/.test(value);
const key = process.env.FLICKR_KEY?.trim();
const secret = process.env.FLICKR_SECRET?.trim();
let credentials = validCredential(key) && validCredential(secret) ? { key, secret } : null;
delete process.env.FLICKR_KEY;
delete process.env.FLICKR_SECRET;
let remembered = false;
let credentialWarning = false;
let savingCredentials = false;
const oauthBase = 'https://www.flickr.com/services/oauth';
const restUrl = 'https://api.flickr.com/services/rest';
const uploadUrl = 'https://up.flickr.com/services/upload/';
const pendingTokens = new Map();
const sessions = new Map();
const reorderingAlbums = new Set();
const extras = 'url_sq,url_t,url_m,url_z,url_l,date_upload,date_taken,media';
const uploadLimit = 100 * 1024 * 1024;

const privacyFlags = {
  public: [1, 0, 0],
  private: [0, 0, 0],
  friends: [0, 1, 0],
  family: [0, 0, 1],
  'friends-family': [0, 1, 1],
};
const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];
const plain = value => typeof value === 'string' ? value : typeof value?._content === 'string' ? value._content : '';
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const requestTimeout = seconds => ({ signal: AbortSignal.timeout(seconds * 1000), redirect: 'error' });

function credentialStore(action, data) {
  const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = fileURLToPath(new URL('./flickr-credentials.ps1', import.meta.url));
  // Windows PowerShell needs its own module paths when started from PowerShell 7.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  return new Promise((resolve, reject) => {
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action],
      { env, windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 }, (error, stdout) => {
        if (error) reject(Error('Windows could not access the saved Flickr credentials.'));
        else resolve(stdout);
      });
    child.stdin.on('error', () => {});
    child.stdin.end(data ? JSON.stringify(data) : '');
  });
}

if (!credentials && canRemember) {
  try {
    const stored = await credentialStore('Load');
    if (stored) {
      const loaded = JSON.parse(stored);
      if (!validCredential(loaded?.key) || !validCredential(loaded?.secret)) throw Error();
      credentials = loaded;
      remembered = true;
    }
  } catch {
    credentialWarning = true;
  }
}

function oauthParams(method, url, args, app, session) {
  const params = new URLSearchParams({
    ...args,
    oauth_consumer_key: app.key,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  });
  if (session) params.set('oauth_token', session.token);
  const pairs = [...params].map(([name, value]) => `${encode(name)}=${encode(value)}`).sort();
  const source = [method, encode(url), encode(pairs.join('&'))].join('&');
  const signingKey = `${encode(app.secret)}&${encode(session?.secret || '')}`;
  params.set('oauth_signature', createHmac('sha1', signingKey).update(source).digest('base64'));
  return params;
}

async function oauth(path, args, app, token) {
  const url = `${oauthBase}/${path}`;
  const params = oauthParams('GET', url, args, app, token);
  const response = await fetch(`${url}?${params}`, requestTimeout(30));
  if (!response.ok) throw fail(`Flickr could not authorize the app (HTTP ${response.status}). Check your API key and secret and try again.`, 502);
  const data = new URLSearchParams(await response.text());
  if (!data.get('oauth_token') || !data.get('oauth_token_secret')) throw fail('Flickr did not send an authorization token.', 502);
  return data;
}

async function flickr(method, args, session) {
  const params = oauthParams('POST', restUrl, { method, api_key: session.app.key, format: 'json', nojsoncallback: '1', ...args }, session.app, session);
  const response = await fetch(restUrl, { ...requestTimeout(30), method: 'POST', body: params });
  if (!response.ok) throw fail(`Flickr returned HTTP ${response.status}.`, 502);
  let data;
  try {
    data = await response.json();
  } catch {
    throw fail('Flickr returned an unreadable response.', 502);
  }
  if (data.stat !== 'ok') {
    throw Object.assign(fail(data.message || 'Flickr rejected the request.', 502), { flickrCode: Number(data.code) });
  }
  return data;
}

async function pages(method, args, session, root, item) {
  const fetchPage = async page => (await flickr(method, { ...args, per_page: 500, page }, session))[root];
  const first = await fetchPage(1);
  const output = [...asArray(first?.[item])];
  const total = Number(first?.pages || 1);
  for (let page = 2; page <= total; page += 4) {
    const next = await Promise.all(Array.from({ length: Math.min(4, total - page + 1) }, (_, i) => fetchPage(page + i)));
    output.push(...next.flatMap(group => asArray(group?.[item])));
  }
  return output;
}

function reply(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function redirect(res, location, cookies) {
  res.writeHead(303, { Location: location, 'Set-Cookie': cookies });
  res.end();
}

const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/${age == null ? '' : `; Max-Age=${age}`}`;
const cookies = req => Object.fromEntries((req.headers.cookie || '').split('; ').map(pair => pair.split('=')));

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw fail('The request is too large.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw fail('The request is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function json(req, limit = 65536) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('Expected a JSON request.', 415);
  const body = await readBody(req, limit);
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw fail('The request contains invalid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Expected a JSON object.');
  return value;
}

const validId = value => typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
function requireId(value) {
  if (!validId(value)) throw fail('Choose a valid Flickr photo or album.');
  return value;
}

function photoList(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(validId)) {
    throw fail('Choose between 1 and 100 valid Flickr photos.');
  }
  return [...new Set(ids)];
}

function textField(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw fail(`${label} must be at most ${max} characters.`);
  return value;
}

function flags(value) {
  if (typeof value !== 'string' || !Object.hasOwn(privacyFlags, value)) throw fail('Choose a valid visibility.');
  const [is_public, is_friend, is_family] = privacyFlags[value];
  return { is_public, is_friend, is_family };
}

function photoPrivacy(visibility = {}) {
  if (Number(visibility.ispublic)) return 'public';
  if (Number(visibility.isfriend)) return Number(visibility.isfamily) ? 'friends-family' : 'friends';
  return Number(visibility.isfamily) ? 'family' : 'private';
}

async function visibilityEdit(photo, privacy, session) {
  const visibility = flags(privacy);
  const knownFlags = (current = {}) => [current.ispublic, current.isfriend, current.isfamily]
    .every(flag => [0, 1, '0', '1', false, true].includes(flag));
  const knownPermissions = (current = {}) => [current.permcomment, current.permaddmeta]
    .every(level => (typeof level === 'number' || typeof level === 'string') && /^[0-3]$/.test(level));
  const current = photo.visibility || {};
  const known = knownFlags(current);
  if (known && photoPrivacy(current) === privacy) return null;
  let permissions = photo.permissions || {};
  if (!known || !knownPermissions(permissions)) {
    const { perms } = await flickr('flickr.photos.getPerms', { photo_id: photo.id }, session);
    permissions = perms || {};
    if (knownFlags(permissions) && photoPrivacy(permissions) === privacy) return null;
  }
  if (!knownPermissions(permissions)) {
    throw fail('Flickr did not return the existing comment and tag permissions. Visibility was left unchanged.', 502);
  }
  const { permcomment, permaddmeta } = permissions;
  return { ...visibility, perm_comment: permcomment, perm_addmeta: permaddmeta };
}

async function ownPhoto(id, session) {
  const { photo } = await flickr('flickr.photos.getInfo', { photo_id: requireId(id) }, session);
  if (!photo || photo.owner?.nsid !== session.userId) throw fail('The photo is not in your Flickr library.', 404);
  return photo;
}

function photoDetails(photo) {
  return {
    id: String(photo.id),
    title: plain(photo.title),
    description: plain(photo.description),
    tags: asArray(photo.tags?.tag).map(tag => tag.raw || plain(tag)).filter(Boolean),
    privacy: photoPrivacy(photo.visibility),
    owner: photo.owner.nsid,
    url: `https://www.flickr.com/photos/${encode(photo.owner.nsid)}/${encode(photo.id)}/`,
    dateTaken: plain(photo.dates?.taken),
    dateUploaded: Number(photo.dates?.posted) || 0,
  };
}

async function editPhoto(body, session) {
  const photo = await ownPhoto(body.id, session);
  const current = photoDetails(photo);
  const meta = {};
  for (const [field, length] of [['title', 300], ['description', 10000]]) {
    if (Object.hasOwn(body, field)) {
      const value = textField(body[field], field === 'title' ? 'Title' : 'Description', length);
      if (value !== current[field]) meta[field] = value;
    }
  }
  const edits = [];
  if (Object.keys(meta).length) edits.push([Object.keys(meta), 'flickr.photos.setMeta', meta]);
  if (Object.hasOwn(body, 'tags')) {
    if (!Array.isArray(body.tags) || body.tags.length > 75 || !body.tags.every(tag => typeof tag === 'string' && tag.length <= 200)) {
      throw fail('Enter up to 75 tags, with no more than 200 characters per tag.');
    }
    const tags = [...new Set(body.tags.map(tag => tag.trim()).filter(Boolean))];
    if (tags.length !== current.tags.length || !tags.every(tag => current.tags.includes(tag))) {
      if (tags.some(tag => /["\r\n]/.test(tag))) throw fail('Tags cannot contain double quotes or line breaks.');
      const encodedTags = tags.map(tag => /\s/.test(tag) ? `"${tag}"` : tag).join(' ');
      edits.push([['tags'], 'flickr.photos.setTags', { tags: encodedTags }]);
    }
  }
  if (Object.hasOwn(body, 'privacy')) {
    const visibility = await visibilityEdit(photo, body.privacy, session);
    if (visibility) edits.push([['privacy'], 'flickr.photos.setPerms', visibility]);
  }
  const updated = [];
  const errors = [];
  for (const [fields, method, args] of edits) {
    try {
      await flickr(method, { photo_id: current.id, ...args }, session);
      updated.push(...fields);
    } catch (error) {
      errors.push(`${fields.join(' and ')}: ${error.message}`);
    }
  }
  return { ok: errors.length === 0, updated, errors };
}

async function addPhoto(albumId, id, session) {
  try {
    await flickr('flickr.photosets.addPhoto', { photoset_id: albumId, photo_id: id }, session);
  } catch (error) {
    if (error.flickrCode !== 3) throw error;
  }
}

function albumPhotos(photoset_id, session, options = {}) {
  return pages('flickr.photosets.getPhotos', { user_id: session.userId, photoset_id, ...options }, session, 'photoset', 'photo');
}

async function reorderAlbum(body, session) {
  const albumId = requireId(body.albumId);
  const { originalPhotoIds, photoIds } = body;
  if (![originalPhotoIds, photoIds].every(ids => Array.isArray(ids) && ids.length > 0 && ids.length <= 10000 && ids.every(validId))) {
    throw fail('Include every photo in the original and new album order, up to 10,000 photos.');
  }
  const original = new Set(originalPhotoIds);
  const reordered = new Set(photoIds);
  if (original.size !== originalPhotoIds.length || reordered.size !== photoIds.length ||
      original.size !== reordered.size || !photoIds.every(id => original.has(id))) {
    throw fail('The original and new order must contain the same photos exactly once.');
  }
  const lock = `${session.userId}/${albumId}`;
  if (reorderingAlbums.has(lock)) throw fail('This album is already being reordered. Refresh it before trying again.', 409);
  const stale = () => fail('This album changed on Flickr. Refresh the album before reordering it.', 409);
  reorderingAlbums.add(lock);
  try {
    let current;
    try {
      current = await albumPhotos(albumId, session);
    } catch (error) {
      if (error.flickrCode === 1) throw stale();
      throw error;
    }
    if (current.length !== originalPhotoIds.length ||
        !current.every((photo, index) => String(photo.id) === originalPhotoIds[index])) throw stale();
    if (photoIds.some((id, index) => id !== originalPhotoIds[index])) {
      await flickr('flickr.photosets.reorderPhotos', { photoset_id: albumId, photo_ids: photoIds.join(',') }, session);
    }
    return { ok: true };
  } finally {
    reorderingAlbums.delete(lock);
  }
}

async function albumAction(body, session) {
  const { action } = body;
  if (action === 'reorder') return reorderAlbum(body, session);
  if (action === 'cover') {
    const photoset_id = requireId(body.albumId);
    const photo_id = requireId(body.photoId);
    const photos = await albumPhotos(photoset_id, session);
    const photo = photos.find(item => String(item.id) === photo_id);
    if (!photo) throw fail('Choose a photo from this album.');
    if (Number(photo.isprimary) !== 1) {
      await flickr('flickr.photosets.setPrimaryPhoto', { photoset_id, photo_id }, session);
    }
    return { ok: true };
  }
  if (action === 'delete') {
    await flickr('flickr.photosets.delete', { photoset_id: requireId(body.albumId) }, session);
    return { ok: true };
  }
  if (!['create', 'edit'].includes(action)) throw fail('Unknown album action.');
  const title = textField(body.title, 'Album title', 200).trim();
  if (!title) throw fail('Enter an album title.');
  const description = textField(body.description ?? '', 'Description', 10000);
  if (action === 'edit') {
    await flickr('flickr.photosets.editMeta', { photoset_id: requireId(body.albumId), title, description }, session);
    return { ok: true };
  }
  const [cover, ...photos] = photoList(body.photoIds);
  const { photoset } = await flickr('flickr.photosets.create', { title, description, primary_photo_id: cover }, session);
  const id = requireId(photoset?.id);
  const errors = [];
  for (const photoId of photos) {
    try {
      await addPhoto(id, photoId, session);
    } catch (error) {
      errors.push(`${photoId}: ${error.message}`);
    }
  }
  return { id, added: photos.length + 1 - errors.length, errors };
}

async function organize(body, session) {
  const ids = photoList(body.photoIds);
  const { action, privacy } = body;
  const albumAction = ['add', 'remove', 'move'].includes(action);
  if (!albumAction && !['delete', 'visibility'].includes(action)) throw fail('Unknown photo action.');
  if (action === 'delete' && session.perms !== 'delete') throw fail('Authorize Flickr delete access first.', 403);
  if (action === 'visibility') flags(privacy);
  const albumId = albumAction ? requireId(body.albumId) : null;
  const sourceId = action === 'move' ? requireId(body.fromAlbumId) : albumId;
  if (action === 'move' && albumId === sourceId) throw fail('Choose a different destination album.');
  const errors = [];
  for (const id of ids) {
    try {
      if (action === 'delete') {
        await flickr('flickr.photos.delete', { photo_id: id }, session);
        continue;
      }
      if (action === 'visibility') {
        const photo = await ownPhoto(id, session);
        const visibility = await visibilityEdit(photo, privacy, session);
        if (visibility) await flickr('flickr.photos.setPerms', { photo_id: id, ...visibility }, session);
        continue;
      }
      if (action !== 'remove') await addPhoto(albumId, id, session);
      if (action === 'remove' || action === 'move') {
        try {
          await flickr('flickr.photosets.removePhoto', { photoset_id: sourceId, photo_id: id }, session);
        } catch (error) {
          if (error.flickrCode === 3) continue;
          if (action === 'move') throw Error(`In destination. Could not confirm removal from source: ${error.message}`);
          throw error;
        }
      }
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  }
  return { done: ids.length - errors.length, errors };
}

async function uploadPhoto(req, session) {
  const contentType = req.headers['content-type'] || '';
  if (!/^multipart\/form-data;/i.test(contentType)) throw fail('Choose an image file to upload.', 415);
  const bytes = await readBody(req, uploadLimit + 65536);
  let submitted;
  try {
    submitted = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw fail('The image upload could not be read.');
  }
  const file = submitted.get('photo');
  if (!(file instanceof File) || !file.size || file.size > uploadLimit) throw fail('Choose a nonempty image up to 100 MB.');
  if (!file.type.startsWith('image/')) throw fail('Choose an image file.');
  const title = textField(submitted.get('title') || file.name, 'Title', 300);
  const args = { api_key: session.app.key, title };
  if (submitted.get('dedup') === '1') args.dedup_check = '1';
  if (submitted.has('description')) args.description = textField(submitted.get('description'), 'Description', 10000);
  if (submitted.has('tags')) args.tags = textField(submitted.get('tags'), 'Tags', 15000);
  if (submitted.get('privacy')) Object.assign(args, flags(submitted.get('privacy')));
  const form = new FormData();
  for (const [name, value] of oauthParams('POST', uploadUrl, args, session.app, session)) form.set(name, value);
  form.set('photo', file, file.name);
  let response, xml;
  try {
    response = await fetch(uploadUrl, { ...requestTimeout(600), method: 'POST', body: form });
    xml = await response.text();
  } catch {
    throw fail('Flickr did not confirm the upload. Check your library before uploading this file again.', 502);
  }
  const id = xml.match(/<photoid(?:\s[^>]*)?>(\d+)<\/photoid>/)?.[1];
  const error = xml.match(/<err\b[^>]*>/)?.[0] || '';
  if (!response.ok || !id || error) {
    const code = error.match(/\bcode="(\d+)"/)?.[1];
    if (args.dedup_check && response.ok && code === '9') return { duplicate: true };
    const rejectedFile = response.ok && ['4', '5', '8'].includes(code);
    throw fail(error.match(/\bmsg="([^"]*)"/)?.[1] || `Flickr could not confirm the upload (HTTP ${response.status}).`, rejectedFile ? 422 : 502);
  }
  return { id };
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

async function handle(req, res) {
  if (req.headers.host !== host) throw fail(`Open the organizer at ${origin}/.`, 403);
  if (req.method === 'POST' && req.headers.origin !== origin) throw fail('Open this action from the local organizer.', 403);
  const url = new URL(req.url, origin);
  const path = url.pathname;
  const jar = cookies(req);
  const session = sessions.get(jar.flickr_session);
  const method = req.method;
  if (method === 'GET' && Object.hasOwn(files, path)) {
    const [name, contentType] = files[path];
    const file = await readFile(new URL(name, import.meta.url));
    res.writeHead(200, { 'Content-Type': contentType });
    return res.end(file);
  }
  if (method === 'GET' && path === '/api/status') {
    return reply(res, 200, {
      configured: Boolean(credentials),
      canRemember,
      remembered,
      credentialWarning,
      connected: Boolean(session),
      bulkVisibility: true,
      albumReorder: true,
      albumCover: true,
      name: session?.name || '',
      canDelete: session?.perms === 'delete',
    });
  }
  if (method === 'POST' && path === '/api/credentials') {
    const body = await json(req);
    const forget = body.action === 'forget';
    const next = forget ? null : {
      key: typeof body.key === 'string' ? body.key.trim() : '',
      secret: typeof body.secret === 'string' ? body.secret.trim() : '',
    };
    if (!forget && (!validCredential(next.key) || !validCredential(next.secret) || typeof body.remember !== 'boolean')) {
      throw fail('Enter your Flickr API key and secret.');
    }
    if (savingCredentials) throw fail('Another credential change is in progress. Try again shortly.', 409);
    savingCredentials = true;
    try {
      if (next && body.remember) {
        if (!canRemember) throw fail('Remembering credentials requires Windows.');
        try { await credentialStore('Save', next); }
        catch { throw fail('Windows could not save the credentials. Uncheck Remember on this PC to continue for this session.', 500); }
      } else if (canRemember && (forget || remembered || credentialWarning)) {
        await credentialStore('Forget');
      }
      credentials = next;
      remembered = Boolean(next && body.remember);
      credentialWarning = false;
      sessions.clear();
      pendingTokens.clear();
      return reply(res, 200, { configured: Boolean(credentials), remembered }, {
        'Set-Cookie': [cookie('flickr_session', '', 0), cookie('flickr_pending', '', 0)],
      });
    } finally {
      savingCredentials = false;
    }
  }
  if (method === 'GET' && path === '/api/connect') {
    const app = credentials;
    if (!app) throw fail('Enter your Flickr API key and secret in the organizer to connect.');
    if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw fail('Start Flickr authorization inside the organizer.', 403);
    const perms = url.searchParams.get('perms') === 'delete' ? 'delete' : 'write';
    const now = Date.now();
    for (const [id, item] of pendingTokens) if (item.expires < now) pendingTokens.delete(id);
    const token = await oauth('request_token', { oauth_callback: `${origin}/api/callback` }, app);
    if (credentials !== app) throw fail('Your API credentials changed. Start Flickr sign-in again.');
    if (token.get('oauth_callback_confirmed') !== 'true') throw fail('Flickr did not confirm the local callback.', 502);
    const id = randomBytes(24).toString('hex');
    pendingTokens.set(id, { app, token: token.get('oauth_token'), secret: token.get('oauth_token_secret'), perms, expires: now + 600000 });
    return redirect(res, `${oauthBase}/authorize?${new URLSearchParams({ oauth_token: token.get('oauth_token'), perms })}`, cookie('flickr_pending', id, 600));
  }
  if (method === 'GET' && path === '/api/callback') {
    const pending = pendingTokens.get(jar.flickr_pending);
    const verifier = url.searchParams.get('oauth_verifier');
    if (!pending || pending.expires < Date.now() || !verifier || url.searchParams.get('oauth_token') !== pending.token) {
      throw fail('Flickr authorization expired or was cancelled. Return to the organizer and connect again.');
    }
    pendingTokens.delete(jar.flickr_pending);
    const token = await oauth('access_token', { oauth_verifier: verifier }, pending.app, pending);
    const authorized = { app: pending.app, token: token.get('oauth_token'), secret: token.get('oauth_token_secret') };
    const { oauth: granted } = await flickr('flickr.auth.oauth.checkToken', {}, authorized);
    const perms = plain(granted?.perms);
    const userId = granted?.user?.nsid || token.get('user_nsid');
    if (credentials !== pending.app) throw fail('Your API credentials changed. Start Flickr sign-in again.');
    if (!userId || !['write', 'delete'].includes(perms)) throw fail('Flickr did not grant write access. Connect again to authorize the organizer.', 403);
    if (pending.perms === 'delete' && perms !== 'delete') throw fail('Flickr did not grant delete access. Return to the organizer to continue with your current access.', 403);
    if (pending.perms === 'delete' && session && userId !== session.userId) {
      throw fail('Sign in to the same Flickr account to authorize deletion.', 403);
    }
    const id = randomBytes(32).toString('hex');
    sessions.delete(jar.flickr_session);
    sessions.set(id, { ...authorized, userId, perms, name: token.get('fullname') || token.get('username') || 'Flickr member' });
    return redirect(res, '/', [cookie('flickr_session', id), cookie('flickr_pending', '', 0)]);
  }
  if (path.startsWith('/api/') && !session) throw fail('Connect your Flickr account first.', 401);
  if (method === 'POST' && path === '/api/disconnect') {
    sessions.delete(jar.flickr_session);
    return reply(res, 200, { ok: true }, { 'Set-Cookie': cookie('flickr_session', '', 0) });
  }
  if (method === 'GET' && path === '/api/library') {
    const [sets, unfiled, photos] = await Promise.all([
      pages('flickr.photosets.getList', { user_id: session.userId }, session, 'photosets', 'photoset'),
      pages('flickr.photos.getNotInSet', { extras }, session, 'photos', 'photo'),
      pages('flickr.people.getPhotos', { user_id: session.userId, extras }, session, 'photos', 'photo'),
    ]);
    const albums = sets.map(album => ({
      ...album,
      title: plain(album.title),
      description: plain(album.description),
      url: `https://www.flickr.com/photos/${encode(session.userId)}/albums/${encode(album.id)}/`,
    }));
    return reply(res, 200, { albums, unfiled, photos });
  }
  if (method === 'GET' && path === '/api/album') {
    const photoset_id = requireId(url.searchParams.get('id'));
    const photo = await albumPhotos(photoset_id, session, { extras });
    return reply(res, 200, { photo });
  }
  if (method === 'GET' && path === '/api/photo') return reply(res, 200, photoDetails(await ownPhoto(url.searchParams.get('id'), session)));
  if (method === 'POST' && path === '/api/photo') return reply(res, 200, await editPhoto(await json(req), session));
  if (method === 'POST' && path === '/api/albums') return reply(res, 200, await albumAction(await json(req, 768 * 1024), session));
  if (method === 'POST' && path === '/api/organize') return reply(res, 200, await organize(await json(req), session));
  if (method === 'POST' && path === '/api/upload') return reply(res, 200, await uploadPhoto(req, session));
  throw fail('This page was not found.', 404);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try {
    await handle(req, res);
  } catch (error) {
    if (!res.headersSent) reply(res, error.status || 502, { error: error.message });
  }
});

server.on('error', error => {
  const port = ports[attempt];
  if (['EADDRINUSE', 'EACCES'].includes(error.code) && attempt + 1 < ports.length) {
    console.log(`Port ${port} is unavailable. Trying another local port.`);
    server.listen(ports[++attempt], address);
    return;
  }
  console.error(port && ['EADDRINUSE', 'EACCES'].includes(error.code)
    ? `Port ${port} is unavailable. Clear the PORT override or choose a different port.`
    : error.message);
  process.exitCode = 1;
});

server.once('listening', () => {
  host = `${address}:${server.address().port}`;
  origin = `http://${host}`;
  console.log(`Flickr Manager: ${origin}/`);
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const env = { ...process.env };
    delete env.FLICKR_KEY;
    delete env.FLICKR_SECRET;
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `${origin}/`], { env, stdio: 'ignore', detached: true, windowsHide: true });
    browser.on('error', () => console.log(`Open ${origin}/ in your browser.`));
    browser.unref();
  }
});
server.listen(ports[attempt], address);
