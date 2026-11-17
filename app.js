const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const plain = value => typeof value === 'string' ? value : typeof value?._content === 'string' ? value._content : '';
const count = n => n.toLocaleString();
const privacyNames = {public:'Public', private:'Private', friends:'Friends', family:'Family', 'friends-family':'Friends and family'};
const pageSize = 48;
const samples = [
  ['Coastal light','coast','1473116763249-2faaef81ccda'],
  ['Kyoto after dark','city','1493976040374-85c8e12f0c0e'],
  ['Mountain air','outdoors','1464822759023-fed622ff2c3b'],
  ['After the rain','city','1519501025264-65ba15a82390'],
  ['Last light on water','coast','1500375592092-40eb2168fd21'],
  ['Sunday flowers','','1490750967868-88aa4486c946'],
  ['Desert road','outdoors','1500530855697-b586d89ba3ee'],
  ['Soft morning','','1470252649378-9c29740c9fa8'],
  ['Looking up','city','1511818966892-d7d671e672a2'],
  ['Window seat','','1445116572660-236099ec97a0'],
  ['Still water','coast','1464278533981-50106e6176b1'],
  ['Night passage','city','1519608487953-e999c86e7455']
];
const state = {
  configured: false, canRemember: false, remembered: false, credentialWarning: false, uploadRunning: false, bulkVisibility: false, albumReorder: false, albumCover: false,
  connected: false, canDelete: false, loading: false, syncing: false, busy: false, stop: false,
  library: new Map(samples.map(([title, album, image], i) => {
    const id = String(i + 1);
    const url = 'https://images.unsplash.com/photo-' + image + '?auto=format&fit=crop&w=';
    return [id, {id, title, album, thumb:url + '600&q=80', preview:url + '1400&q=85', uploaded:1727300000 - i * 86400, privacy:i % 3 ? 'public' : 'private'}];
  })),
  albums: [
    {id:'coast', title:'Coastline', description:'Along the water.', photos:3},
    {id:'city', title:'City nights', description:'An evening in the city.', photos:4},
    {id:'outdoors', title:'Outdoors', description:'Away from the city.', photos:2}
  ],
  unfiled: new Set(samples.flatMap(([, album], i) => album ? [] : [String(i + 1)])),
  view: 'all', albumId: '', albumPhotos: [], request: 0,
  selected: new Set(), matches: [], limit: pageSize, activity: null, reorder: null
};

async function api(path, payload) {
  const options = payload instanceof FormData ? {method:'POST', body:payload} :
    payload === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)};
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw Object.assign(Error(data?.error || 'The local server returned an invalid response.'), {httpStatus:response.status});
  }
  return data;
}

function photoFromFlickr(photo, fallback) {
  const id = String(photo.id);
  const original = photo.server && photo.secret ? 'https://live.staticflickr.com/' + photo.server + '/' + id + '_' + photo.secret + '_m.jpg' : '';
  const friend = Number(photo.isfriend) === 1;
  const family = Number(photo.isfamily) === 1;
  let privacy = fallback?.privacy;
  if (photo.ispublic !== undefined) {
    privacy = Number(photo.ispublic) === 1 ? 'public' : 'private';
    if (privacy !== 'public' && (friend || family)) privacy = friend && family ? 'friends-family' : friend ? 'friends' : 'family';
  }
  const thumb = photo.url_m || photo.url_q || photo.url_t || photo.url_z || fallback?.thumb || original;
  return {
    id, title: plain(photo.title) || fallback?.title || 'Untitled photo',
    owner: photo.owner || fallback?.owner,
    thumb, preview: photo.url_l || photo.url_z || fallback?.preview || thumb,
    uploaded: Number(photo.dateupload || fallback?.uploaded || 0), privacy
  };
}

const currentAlbum = () => state.albums.find(album => album.id === state.albumId);
const photoLink = photo => photo.owner ? 'https://www.flickr.com/photos/' + encodeURIComponent(photo.owner) + '/' + encodeURIComponent(photo.id) : '';
const showNotice = message => {
  clearTimeout(showNotice.timer);
  $('notice').textContent = message;
  $('notice').hidden = false;
  showNotice.timer = setTimeout(() => $('notice').hidden = true, 6500);
};

function drawAlbums() {
  const query = $('albumSearch').value.trim().toLowerCase();
  const entries = state.albums.filter(album => album.title.toLowerCase().includes(query));
  $('albumNav').innerHTML = entries.map(album => `<button class="nav" data-album="${esc(album.id)}" ${album.id === state.albumId ? 'aria-current="page"' : ''}><span><span aria-hidden="true">▱</span> ${esc(album.title)}</span><span>${esc(album.photos ?? '')}</span></button>`).join('') ||
    '<p class="side-empty">' + (query ? 'No matching albums.' : 'No albums yet.') + '</p>';
  $('allCount').textContent = count(state.library.size);
  $('unfiledCount').textContent = count(state.unfiled.size);
  for (const button of document.querySelectorAll('[data-view]')) {
    if (!state.albumId && button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function renderSelection() {
  if (state.reorder) {
    $('selectionBar').hidden = true;
    return;
  }
  const n = state.selected.size;
  $('selectionBar').hidden = n === 0;
  $('selectionCount').textContent = count(n) + ' selected';
  $('move').hidden = !state.albumId;
  $('remove').hidden = !state.albumId;
  const album = currentAlbum();
  const cover = $('setAlbumCover');
  cover.hidden = !album || n !== 1;
  cover.disabled = state.busy || state.loading || (album?.primary && state.selected.has(String(album.primary)));
  $('add').disabled = state.busy || state.loading || !state.albums.some(album => album.id !== state.albumId);
  $('move').disabled = state.busy || state.loading || state.albums.length < 2;
  for (const id of ['changeVisibility','remove','createSelected','delete','clear']) $(id).disabled = state.busy || state.loading;
  const allSelected = state.matches.length && state.matches.every(photo => state.selected.has(photo.id));
  $('selectMatching').textContent = allSelected ? 'Clear matching' : 'Select all matching';
  $('selectMatching').disabled = !state.matches.length || state.busy || state.loading;
}

function render() {
  const album = currentAlbum();
  const reorder = state.reorder;
  const unfiled = state.view === 'unfiled' && !album;
  $('heading').textContent = album?.title || (unfiled ? 'Not in an album' : 'All photos');
  $('breadcrumb').textContent = (album ? 'Albums / ' : 'Library / ') + $('heading').textContent;
  $('context').textContent = album ? album.description || 'Photos in this album.' :
    unfiled ? 'Photos that don’t belong to an album.' : 'Browse and organize your photo library.';
  $('query').placeholder = album ? 'Search within this album…' : 'Search photo titles…';
  $('albumTools').hidden = !album;
  const albumLink = $('viewAlbum');
  albumLink.hidden = !album?.url;
  if (album?.url) albumLink.href = album.url;
  else albumLink.removeAttribute('href');
  $('reorderAlbum').hidden = Boolean(reorder);
  $('reorderAlbum').disabled = state.busy || state.loading || state.albumPhotos.length < 2;
  $('sort').querySelector('[value=album]').hidden = !album;
  for (const id of ['newAlbum','editAlbum','deleteAlbum','refresh','connect','credentialSettings']) $(id).disabled = state.busy || state.loading || Boolean(reorder);
  for (const button of document.querySelectorAll('[data-view], #albumNav [data-album]')) button.disabled = Boolean(reorder);
  $('albumSearch').disabled = $('activity').disabled = Boolean(reorder);
  $('upload').disabled = Boolean(reorder) || ((state.busy || state.loading) && !state.uploadRunning);
  $('upload').textContent = state.uploadRunning ? 'Queue another upload' : '↑ Upload photos';
  renderUploadQueue();
  renderGridReorder();
  const query = $('query').value.trim().toLowerCase();
  const visibility = $('filter').value;
  const sort = $('sort').value;
  const scope = album ? state.albumPhotos : [...state.library.values()];
  const matches = reorder ? reorder.photos : state.loading ? [] : scope.filter(p => (!unfiled || state.unfiled.has(p.id)) &&
    (!visibility || p.privacy === visibility) && p.title.toLowerCase().includes(query));
  if (!reorder) {
    if (sort === 'title') matches.sort((a,b) => a.title.localeCompare(b.title, undefined, {numeric:true}));
    if (sort === 'old') matches.sort((a,b) => a.uploaded - b.uploaded);
    if (sort === 'new') matches.sort((a,b) => b.uploaded - a.uploaded);
  }
  state.matches = matches;
  const visible = reorder ? matches : matches.slice(0, state.limit);
  $('resultCount').textContent = state.loading ? 'Loading photos…' : (visible.length < matches.length ? count(visible.length) + ' of ' : '') +
    count(matches.length) + (matches.length === 1 ? ' photo' : ' photos');
  const group = reorder ? groupedSelection() : null;
  const first = group ? matches.findIndex(photo => group.has(photo.id)) : -1;
  const last = group ? matches.findLastIndex(photo => group.has(photo.id)) : -1;
  $('grid').classList.toggle('reordering-grid', Boolean(reorder));
  $('grid').innerHTML = visible.map((photo, index) => {
    const id = esc(photo.id), title = esc(photo.title);
    const selected = state.selected.has(photo.id);
    const meta = state.unfiled.has(photo.id) ? 'Not in an album' : photo.privacy ? privacyNames[photo.privacy] : 'In an album';
    const groupMember = group?.has(photo.id);
    const steps = reorder ? `<div class="grid-reorder-steps">
      <span aria-label="Position ${index + 1}">${index + 1}</span>
      <button type="button" class="square" data-grid-step="up" aria-label="Move ${title} earlier" ${(groupMember ? first : index) === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="square" data-grid-step="down" aria-label="Move ${title} later" ${(groupMember ? last : index) === matches.length - 1 ? 'disabled' : ''}>↓</button>
    </div>` : '';
    return `<article class="card${selected ? ' selected' : ''}" ${reorder ? `data-reorder-id="${id}" draggable="true"` : ''}>
      <button class="thumb" type="button" data-preview="${id}" ${reorder ? 'draggable="true" tabindex="-1"' : ''} aria-label="${reorder ? 'Drag' : 'Open'} ${title}">${photo.thumb ? `<img src="${esc(photo.thumb)}" alt="" ${reorder ? 'draggable="false"' : ''} loading="lazy" decoding="async">` : ''}</button>
      <label class="pick"><input type="checkbox" data-select="${id}" aria-label="Select ${title}" ${selected ? 'checked' : ''} ${state.busy ? 'disabled' : ''}></label>
      ${String(album?.primary ?? '') === photo.id ? '<span class="cover-badge">Album cover</span>' : ''}
      <div class="card-body"><span class="card-title" title="${title}">${title}</span><span class="card-meta">${esc(meta)}</span></div>
      ${steps}
    </article>`;
  }).join('') || '<div class="empty">' + (state.loading ? 'Getting the photos from Flickr.' : 'No matching photos.') + '</div>';
  $('loadMore').hidden = visible.length >= matches.length;
  renderSelection();
}

function resetSelection() {
  state.selected.clear();
  state.limit = pageSize;
}

async function browse(view, albumId = '') {
  if (state.busy || state.syncing || state.reorder) return;
  const request = ++state.request;
  state.view = view;
  state.albumId = albumId;
  state.albumPhotos = [];
  state.loading = Boolean(albumId && state.connected);
  $('query').value = '';
  $('filter').value = '';
  $('sort').value = albumId ? 'album' : 'new';
  resetSelection();
  drawAlbums();
  if (!state.connected && albumId) state.albumPhotos = [...state.library.values()].filter(p => p.album === albumId);
  render();
  if (!state.loading) return;
  try {
    const data = await api('/api/album?id=' + encodeURIComponent(albumId));
    if (request !== state.request) return;
    state.albumPhotos = data.photo.map(p => photoFromFlickr(p, state.library.get(String(p.id))));
  } catch (error) {
    if (request === state.request) showNotice(error.message);
  } finally {
    if (request === state.request) { state.loading = false; render(); }
  }
}

async function refreshLibrary(albumId = state.albumId) {
  const request = ++state.request;
  state.syncing = true;
  state.loading = true;
  render();
  try {
    const data = await api('/api/library');
    if (request !== state.request) return;
    state.library = new Map(data.photos.map(p => [String(p.id), photoFromFlickr(p)]));
    state.unfiled = new Set(data.unfiled.map(p => String(p.id)));
    state.albums = data.albums.map(a => ({...a, id:String(a.id), title:plain(a.title) || 'Untitled album', description:plain(a.description)}));
    state.albumId = state.albums.some(a => a.id === albumId) ? albumId : '';
    state.albumPhotos = [];
    if (!state.albumId && $('sort').value === 'album') $('sort').value = 'new';
    if (state.albumId) {
      const result = await api('/api/album?id=' + encodeURIComponent(state.albumId));
      if (request !== state.request) return;
      state.albumPhotos = result.photo.map(p => photoFromFlickr(p, state.library.get(String(p.id))));
    }
    for (const id of state.selected) if (!state.library.has(id) && !state.albumPhotos.some(p => p.id === id)) state.selected.delete(id);
  } finally {
    if (request === state.request) { state.syncing = state.loading = false; drawAlbums(); render(); }
  }
}

function connectPrompt() {
  if (state.configured) {
    location.href = '/api/connect';
    return;
  }
  credentialSettings();
}

function credentialSettings() {
  if (location.protocol === 'file:') {
    dialog('Start Flickr Manager', '<p>Double-click <strong>Start Flickr Manager.cmd</strong>. It opens the local app in your browser, where you can enter your Flickr credentials.</p>');
    return;
  }
  const findKey = '<p><a href="https://www.flickr.com/services/apps/by/me" target="_blank" rel="noopener noreferrer">Find your API key and secret on Flickr ↗</a></p>';
  const remember = state.canRemember ? '<label class="remember"><input type="checkbox" name="remember"> Remember on this PC</label>' : '';
  const forget = state.configured || state.credentialWarning ?
    '<div><button type="button" id="forgetCredentials" class="button danger">Forget API credentials</button></div>' : '';
  const status = state.credentialWarning ? '<p>Windows could not read the saved credentials. Enter them again to continue.</p>' :
    state.remembered ? '<p>Credentials are saved for this Windows user. Enter replacement credentials below if needed.</p>' : '';
  dialog('Flickr API settings', status + findKey +
    '<label>API key<input name="key" maxlength="256" autocomplete="off" spellcheck="false" required></label>' +
    '<label>API secret<input name="secret" type="password" maxlength="256" autocomplete="off" required></label>' +
    remember + forget, 'Continue to Flickr', async form => {
      await api('/api/credentials', { key:form.get('key'), secret:form.get('secret'), remember:form.has('remember') });
      $('dialogForm').reset();
      location.href = '/api/connect';
    });
  if (forget) $('forgetCredentials').onclick = () => {
    dialog('Forget API credentials', '<p>Remove these credentials from Flickr Manager on this PC and disconnect the current session?</p>',
      'Forget credentials', async () => {
        await api('/api/credentials', {action:'forget'});
        location.reload();
      });
  };
}

let submitAction;
const modal = $('dialog');
function dialog(title, body, label = '', submit, wide = false) {
  $('dialogTitle').textContent = title;
  $('dialogBody').innerHTML = body;
  $('dialogError').hidden = true;
  $('submitDialog').hidden = !label;
  $('submitDialog').disabled = false;
  $('submitDialog').textContent = label;
  $('cancelDialog').textContent = label ? 'Cancel' : 'Close';
  $('closeDialog').disabled = false;
  $('cancelDialog').disabled = false;
  modal.classList.toggle('wide', wide);
  submitAction = submit;
  if (!modal.open) modal.showModal();
  ($('dialogBody').querySelector('input,select,textarea') || $('closeDialog')).focus();
}

function closeDialog() { if (!$('closeDialog').disabled) modal.close(); }
$('closeDialog').onclick = $('cancelDialog').onclick = closeDialog;
modal.addEventListener('cancel', event => { if ($('closeDialog').disabled) event.preventDefault(); });
$('dialogForm').onsubmit = async event => {
  event.preventDefault();
  if (!submitAction || $('submitDialog').disabled) return;
  $('submitDialog').disabled = $('closeDialog').disabled = $('cancelDialog').disabled = true;
  $('dialogError').hidden = true;
  try { await submitAction(new FormData(event.currentTarget)); }
  catch (error) {
    if (modal.open) { $('dialogError').textContent = error.message; $('dialogError').hidden = false; }
    else showNotice(error.message);
  } finally {
    $('submitDialog').disabled = $('closeDialog').disabled = $('cancelDialog').disabled = false;
  }
};

function albumField({exclude = '', defaultId = ''} = {}) {
  const candidates = state.albums.filter(a => a.id !== exclude);
  const names = new Map();
  for (const album of candidates) names.set(album.title, (names.get(album.title) || 0) + 1);
  const options = candidates.map(a => `<option value="${esc(a.id)}" ${a.id === defaultId ? 'selected' : ''}>${esc(a.title + (names.get(a.title) > 1 ? ' · ' + a.id : ''))}</option>`).join('');
  return `<label>Destination album<select name="album" required><option value="">Choose an album…</option>${options}</select></label>`;
}

function privacyField(value) {
  const options = Object.entries(privacyNames).map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('');
  const prompt = value === '' ? '<option value="" selected disabled>Choose visibility…</option>' : '';
  return '<label>Visibility<select name="privacy" required>' + prompt + options + '</select></label>';
}

const tagsField = tags => `<label>Tags <small>Put one tag on each line.</small><textarea name="tags" rows="2">${esc(tags.join('\n'))}</textarea></label>`;
const descriptionField = value => `<label>Description<textarea name="description" rows="3">${esc(value)}</textarea></label>`;
const parseTags = value => [...new Set(String(value).split(/\r?\n/).map(tag => tag.trim()).filter(Boolean))];

async function preview(id) {
  if (state.busy) return;
  const photo = state.matches.find(item => item.id === id);
  if (!photo) return;
  const image = photo.preview ? `<img class="photo-preview" src="${esc(photo.preview)}" alt="${esc(photo.title)}">` : '';
  const link = photoLink(photo);
  const safeLink = link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open on Flickr ↗</a>` : '';
  if (!state.connected) return dialog(photo.title, image + '<p>Connect to Flickr to edit photo details.</p>', '', null, true);
  const view = ++preview.request;
  dialog(photo.title, image + '<p>Loading photo details…</p>', '', null, true);
  try {
    const details = await api('/api/photo?id=' + encodeURIComponent(id));
    if (!modal.open || view !== preview.request) return;
    const fields = `<label>Title<input name="title" maxlength="255" value="${esc(details.title)}"></label>
      ${descriptionField(details.description)}${tagsField(details.tags || [])}${privacyField(details.privacy || 'private')}
      ${details.dateTaken ? '<small>Taken ' + esc(details.dateTaken) + '</small>' : ''}${safeLink}`;
    dialog('Edit photo details', `<div class="photo-editor"><div>${image}</div><div class="metadata">${fields}</div></div>`, 'Save details', async form => {
      const tags = parseTags(form.get('tags'));
      const update = {id};
      for (const field of ['title','description','privacy']) {
        if (form.get(field) !== String(details[field] ?? '').replace(/\r\n?/g, '\n')) update[field] = form.get(field);
      }
      if (form.get('tags') !== (details.tags || []).join('\n').replace(/\r\n?/g, '\n')) update.tags = tags;
      if (Object.keys(update).length === 1) { modal.close(); return; }
      const result = await api('/api/photo', update);
      if (Array.isArray(result.updated)) {
        for (const key of result.updated) details[key] = update[key];
      }
      if (result.errors?.length) {
        const issues = result.errors.map(e => typeof e === 'string' ? e : e.message || e.error || 'Flickr rejected a field.');
        throw Error((result.updated?.length ? 'Some fields were saved. ' : '') + issues.join(' '));
      }
      modal.close();
      showNotice('Photo details saved.');
      await refreshLibrary();
    }, true);
  } catch (error) {
    if (modal.open && view === preview.request) {
      dialog(photo.title, image + '<p>' + esc(error.message) + '</p>' + safeLink, '', null, true);
    }
  }
}
preview.request = 0;
modal.addEventListener('close', () => { preview.request++; });

const receipt = (label, total) => ({label, total, done:0, duplicates:0, failed:0, unknown:0, skipped:0, issues:[]});
const processedCount = report => report.done + report.duplicates + report.failed + report.unknown;
const summary = report => [
  count(report.done) + ' completed',
  report.duplicates && count(report.duplicates) + ' duplicates skipped',
  report.failed && count(report.failed) + ' failed',
  report.unknown && count(report.unknown) + ' unconfirmed',
  report.skipped && count(report.skipped) + ' never sent'
].filter(Boolean).join(' · ');

function workProgress(message, value, total) {
  $('workMessage').textContent = message;
  $('workProgress').max = Math.max(total, 1);
  $('workProgress').value = value;
}

async function runWork(label, total, run, destination) {
  if (state.busy) return;
  state.busy = true;
  state.stop = false;
  $('stopWork').hidden = false;
  $('stopWork').disabled = false;
  $('stopWork').textContent = 'Stop after current';
  $('workStatus').hidden = false;
  $('uploadStats').hidden = true;
  const report = receipt(label, total);
  workProgress(label + '…', 0, total);
  render();
  try {
    await run(report);
  } catch (error) {
    report.issues.push(error.message);
  } finally {
    const accounted = processedCount(report);
    report.skipped = Math.max(0, total - accounted);
    state.activity = report;
    state.selected.clear();
    $('activity').hidden = false;
    $('stopWork').hidden = true;
    if (state.connected) {
      try { await refreshLibrary(destination?.()); }
      catch (error) { report.issues.push('Library refresh failed. ' + error.message); }
    }
    workProgress(label + ' · ' + summary(report) + (report.issues.length ? ' · See activity for details' : ''), accounted, total);
    state.busy = false;
    render();
    showNotice(summary(report));
  }
  return report;
}

function addResult(report, data, length) {
  const done = Number(data.done) || 0;
  const errors = data.errors || [];
  report.done += done;
  report.failed += errors.length;
  report.unknown += Math.max(0, length - done - errors.length);
  report.issues.push(...errors);
}

async function batches(report, action, ids, extra = {}) {
  for (let index = 0; index < ids.length && !state.stop; index += 25) {
    const photoIds = ids.slice(index, index + 25);
    workProgress(report.label + ' · batch ' + count(Math.floor(index / 25) + 1), report.done + report.failed, report.total);
    try {
      const result = await api('/api/organize', {action, photoIds, ...extra});
      addResult(report, result, photoIds.length);
    } catch (error) {
      if (error.httpStatus >= 400 && error.httpStatus < 500) {
        report.failed += photoIds.length;
        report.issues.push('The manager rejected this batch before sending it to Flickr. ' + error.message);
      } else {
        report.unknown += photoIds.length;
        report.issues.push('Batch results unconfirmed. Refresh and review before retrying. ' + error.message);
      }
      break;
    }
  }
}

function photoAction(action) {
  if (!state.connected) return connectPrompt();
  const ids = [...state.selected];
  if (!ids.length || state.busy) return;
  const album = currentAlbum();
  if ((action === 'move' || action === 'remove') && !album) return;
  if (action === 'delete' && !state.canDelete) {
    return dialog('Authorize photo deletion', '<p>Flickr requires extra permission to permanently delete photos. After you return, select your photos again and confirm the deletion.</p>',
      'Authorize on Flickr', () => { location.href = '/api/connect?perms=delete'; });
  }
  const labels = {add:'Add to album', move:'Move photos', remove:'Remove from album', delete:'Permanently delete photos'};
  const text = {add:'Add the selected photos to another album.', move:'Add the selected photos to the destination before removing them from ' + album?.title + '.',
    remove:'Remove the selected photos from ' + album?.title + '. They stay in your Flickr library.',
    delete:'Permanently delete ' + count(ids.length) + ' selected photos from your Flickr account and all its albums. This cannot be undone.'};
  const warning = (action === 'remove' || action === 'move') && ids.length >= state.albumPhotos.length ?
    '<p>Flickr deletes an album when its last photo is removed.</p>' : '';
  const fields = (action === 'add' || action === 'move') ? albumField({exclude:album?.id}) : '';
  dialog(labels[action], '<p>' + esc(count(ids.length) + ' selected. ' + text[action]) + '</p>' + warning + fields,
    labels[action], async form => {
      const albumId = action === 'remove' ? album.id : form.get('album') || undefined;
      modal.close();
      await runWork(labels[action], ids.length, report => batches(report, action, ids, {albumId, fromAlbumId:album?.id}));
    });
}

function changeVisibility() {
  if (!state.connected) return connectPrompt();
  if (!state.bulkVisibility) {
    return dialog('Restart Flickr Manager',
      '<p>The running launcher is an older version. Finish or stop any uploads, close the launcher window, and open <strong>Start Flickr Manager.cmd</strong> again. Log in, refresh the library, and reselect the photos you want to update.</p>');
  }
  const ids = [...state.selected];
  if (!ids.length || state.busy || state.loading) return;
  const total = count(ids.length) + (ids.length === 1 ? ' selected photo' : ' selected photos');
  dialog('Change visibility', '<p>Choose who can see ' + esc(total) + ' on Flickr.</p>' +
    privacyField('') + '<p id="visibilityEffect" role="status" hidden>Anyone can see public photos wherever they appear on Flickr.</p>',
  'Apply visibility', async form => {
    const privacy = form.get('privacy');
    if (!Object.hasOwn(privacyNames, privacy)) throw Error('Choose a visibility.');
    modal.close();
    await runWork('Change visibility to ' + privacyNames[privacy], ids.length,
      report => batches(report, 'visibility', ids, {privacy}));
  });
  const privacy = $('dialogForm').elements.privacy;
  const submit = $('submitDialog');
  submit.disabled = true;
  privacy.onchange = () => {
    $('visibilityEffect').hidden = privacy.value !== 'public';
    submit.textContent = privacy.value === 'public' ? 'Make public' : 'Apply visibility';
    submit.disabled = !privacy.value;
  };
}

function editAlbum(album) {
  if (!state.connected) return connectPrompt();
  const ids = [...state.selected];
  if (!album && !ids.length) return uploader('new');
  const fields = `<label>Album name<input name="title" maxlength="200" required value="${esc(album?.title)}"></label>${descriptionField(album?.description)}`;
  dialog(album ? 'Edit album' : 'Create album', fields +
    (album ? '' : '<p>The first selected photo becomes the cover. The other selected photos are added in batches.</p>'),
  album ? 'Save album' : 'Create album', async form => {
    const title = form.get('title').trim();
    const description = form.get('description');
    if (!title) throw Error('Enter an album name.');
    if (album) {
      await api('/api/albums', {action:'edit', albumId:album.id, title, description});
      modal.close();
      showNotice('Album updated.');
      await refreshLibrary(album.id);
      return;
    }
    const data = await api('/api/albums', {action:'create', title, description, photoIds:ids.slice(0, 1)});
    modal.close();
    $('sort').value = 'album';
    $('query').value = '';
    $('filter').value = '';
    await runWork('Create album', ids.length, async report => {
      report.done = 1;
      await batches(report, 'add', ids.slice(1), {albumId:data.id});
    }, () => String(data.id));
  });
}

$('deleteAlbum').onclick = () => {
  const album = currentAlbum();
  if (!album) return;
  if (!state.connected) return connectPrompt();
  dialog('Delete album', '<p>Delete “' + esc(album.title) + '”? The photos stay in your Flickr library.</p>', 'Delete album', async () => {
    await api('/api/albums', {action:'delete', albumId:album.id});
    modal.close();
    resetSelection();
    state.view = 'all';
    showNotice('Album deleted.');
    await refreshLibrary('');
  });
};

function reorderAlbum() {
  const album = currentAlbum();
  if (!album || state.loading || state.busy || state.reorder) return;
  if (!state.connected) return connectPrompt();
  if (!state.albumReorder) {
    return dialog('Restart Flickr Manager', '<p>Close the old launcher and open <strong>Start Flickr Manager.cmd</strong> again to reorder albums.</p>');
  }
  const photos = state.albumPhotos.slice();
  if (photos.length < 2) return;
  state.reorder = {
    albumId:album.id, photos, originalPhotoIds:photos.map(photo => photo.id),
    originalSelection:new Set(state.selected), saving:false, message:'', error:''
  };
  $('gridAlbumOrder').value = 'manual';
  render();
  $('gridAlbumOrder').focus();
}

function groupedSelection() {
  return state.selected.size > 1 && state.selected.size < state.reorder.photos.length ? state.selected : null;
}

const gridOrderChanged = draft => draft.photos.some((photo, index) => photo.id !== draft.originalPhotoIds[index]);

function renderGridReorder() {
  const draft = state.reorder;
  $('gridReorder').hidden = !draft;
  $('photoToolbar').hidden = Boolean(draft);
  $('grid').inert = Boolean(draft?.saving);
  if (!draft) return;
  const dirty = gridOrderChanged(draft);
  const group = groupedSelection();
  const selected = state.selected.size;
  $('gridReorderHelp').textContent = 'Select photos to move them to the top or bottom. Drag thumbnails or use the arrows to place them between other photos.' +
    (group ? ' Drag any selected thumbnail to move the ' + count(group.size) + ' selected photos together.' : '');
  $('gridReorderStatus').textContent = draft.saving ? 'Saving album order…' :
    draft.message || (dirty ? 'Unsaved changes.' : 'Current album order.');
  $('gridReorderError').hidden = !draft.error;
  $('gridReorderError').textContent = draft.error;
  $('saveGridOrder').disabled = $('resetGridOrder').disabled = draft.saving || !dirty;
  $('cancelGridOrder').disabled = $('gridAlbumOrder').disabled = draft.saving;
  $('moveGridTop').disabled = draft.saving || !selected ||
    draft.photos.slice(0, selected).every(photo => state.selected.has(photo.id));
  $('moveGridBottom').disabled = draft.saving || !selected ||
    draft.photos.slice(-selected).every(photo => state.selected.has(photo.id));
  $('clearGridSelection').hidden = selected === 0;
  $('clearGridSelection').disabled = draft.saving;
}

function movingGridPhotos(id) {
  const group = groupedSelection();
  return group?.has(id) ? group : new Set([id]);
}

function moveGridPhotos(id, target, before) {
  const draft = state.reorder;
  if (!draft || draft.saving) return;
  const ids = movingGridPhotos(id);
  if (!target || ids.has(target)) return;
  const selected = draft.photos.filter(photo => ids.has(photo.id));
  const remaining = draft.photos.filter(photo => !ids.has(photo.id));
  const index = remaining.findIndex(photo => photo.id === target);
  if (!selected.length || index < 0) return;
  const position = index + (before ? 0 : 1);
  draft.photos = [...remaining.slice(0, position), ...selected, ...remaining.slice(position)];
  draft.message = (selected.length === 1 ? selected[0].title : count(selected.length) + ' selected photos') +
    ' moved to position ' + count(position + 1) + '.';
  draft.error = '';
  $('gridAlbumOrder').value = 'manual';
  render();
}

function moveGridSelectionToEdge(top) {
  const draft = state.reorder;
  if (!draft || draft.saving || !state.selected.size) return;
  const unselected = photo => !state.selected.has(photo.id);
  const target = top ? draft.photos.find(unselected) : draft.photos.findLast(unselected);
  moveGridPhotos(state.selected.values().next().value, target?.id, top);
}

function stepGridPhoto(button) {
  const draft = state.reorder;
  if (!draft || draft.saving) return;
  const id = button.closest('[data-reorder-id]').dataset.reorderId;
  const ids = movingGridPhotos(id);
  const up = button.dataset.gridStep === 'up';
  const index = up ? draft.photos.findIndex(photo => ids.has(photo.id)) :
    draft.photos.findLastIndex(photo => ids.has(photo.id));
  moveGridPhotos(id, draft.photos[index + (up ? -1 : 1)]?.id, up);
  const row = $('grid').querySelector('[data-reorder-id="' + CSS.escape(id) + '"]');
  const next = row?.querySelector('[data-grid-step="' + button.dataset.gridStep + '"]:enabled') ||
    row?.querySelector('[data-grid-step]:enabled');
  next?.focus();
}

function cancelGridOrder() {
  const draft = state.reorder;
  if (!draft || draft.saving) return;
  endGridDrag();
  state.selected = draft.originalSelection;
  state.reorder = null;
  render();
  $('reorderAlbum').focus();
}

async function saveGridOrder() {
  const draft = state.reorder;
  if (!draft || draft.saving || !gridOrderChanged(draft)) return;
  endGridDrag();
  draft.saving = true;
  draft.error = '';
  renderGridReorder();
  try {
    await api('/api/albums', {action:'reorder', albumId:draft.albumId,
      originalPhotoIds:draft.originalPhotoIds, photoIds:draft.photos.map(photo => photo.id)});
  } catch (error) {
    draft.error = error.message;
    draft.saving = false;
    renderGridReorder();
    return;
  }
  state.reorder = null;
  showNotice('Album order saved.');
  await browse('all', draft.albumId);
}

let draggingThumbnail = '';
let thumbnailDropTarget = null;
let gridDragPoint = null;
let gridScrollFrame = 0;
let lastGridScrollFrame = 0;

function clearThumbnailDrop() {
  thumbnailDropTarget?.classList.remove('drop-before', 'drop-after');
  thumbnailDropTarget = null;
}

function endGridDrag() {
  draggingThumbnail = '';
  stopGridScroll();
  clearThumbnailDrop();
  $('grid').querySelector('.is-dragging')?.classList.remove('is-dragging');
}

function beforeGridThumbnail(x, card) {
  const bounds = card.getBoundingClientRect();
  return x < bounds.left + bounds.width / 2;
}

function markThumbnailDrop({x, y}) {
  const card = document.elementFromPoint(x, y)?.closest('[data-reorder-id]');
  if (!card || movingGridPhotos(draggingThumbnail).has(card.dataset.reorderId)) {
    clearThumbnailDrop();
    return null;
  }
  const side = beforeGridThumbnail(x, card) ? 'drop-before' : 'drop-after';
  if (thumbnailDropTarget !== card || !card.classList.contains(side)) {
    clearThumbnailDrop();
    thumbnailDropTarget = card;
    card.classList.add(side);
  }
  return card;
}

function gridScrollSpeed({y}) {
  const toolbar = $('gridReorder').getBoundingClientRect();
  const top = toolbar.top <= 10 ? toolbar.bottom : 0;
  const band = Math.min(100, (window.innerHeight - top) / 3);
  if (band <= 0) return 0;
  const up = (top + band - y) / band;
  const down = (y - (window.innerHeight - band)) / band;
  if (up > 0) return -(120 + 1680 * Math.min(1, up) ** 2);
  return down > 0 ? 120 + 1680 * Math.min(1, down) ** 2 : 0;
}

function stopGridScroll() {
  cancelAnimationFrame(gridScrollFrame);
  gridScrollFrame = lastGridScrollFrame = 0;
  gridDragPoint = null;
}

function scrollGridDuringDrag(time) {
  gridScrollFrame = 0;
  if (!state.reorder || !draggingThumbnail || !gridDragPoint) return;
  const speed = gridScrollSpeed(gridDragPoint);
  if (!speed) { lastGridScrollFrame = 0; return; }
  const elapsed = lastGridScrollFrame ? Math.min(32, time - lastGridScrollFrame) : 16;
  lastGridScrollFrame = time;
  const before = window.scrollY;
  window.scrollBy(0, Math.sign(speed) * Math.max(1, Math.round(Math.abs(speed) * elapsed / 1000)));
  if (window.scrollY === before) { lastGridScrollFrame = 0; return; }
  markThumbnailDrop(gridDragPoint);
  gridScrollFrame = requestAnimationFrame(scrollGridDuringDrag);
}

function setAlbumCover() {
  const album = currentAlbum();
  if (!album || state.selected.size !== 1 || state.loading || state.busy) return;
  if (!state.connected) return connectPrompt();
  if (!state.albumCover) {
    return dialog('Restart Flickr Manager', '<p>Close the old launcher and open <strong>Start Flickr Manager.cmd</strong> again to set an album cover.</p>');
  }
  const photo = state.albumPhotos.find(photo => state.selected.has(photo.id));
  if (!photo || String(album.primary ?? '') === photo.id) return;
  dialog('Set album cover', '<p>Use “' + esc(photo.title) + '” as the cover for “' + esc(album.title) + '”?</p>',
    'Set album cover', async () => {
      await api('/api/albums', {action:'cover', albumId:album.id, photoId:photo.id});
      album.primary = photo.id;
      modal.close();
      render();
      showNotice('Album cover saved.');
    });
}

function duration(seconds) {
  const total = Math.max(1, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  if (hours) return hours + ' h ' + minutes + ' min';
  if (minutes) return minutes + ' min ' + total % 60 + ' s';
  return total + ' s';
}

function uploadMeter(files, report) {
  const started = performance.now();
  let remaining = files.reduce((bytes, file) => bytes + file.size, 0);
  let confirmed = 0;
  let average = 0;
  let currentBytes = 0;
  let currentStart = started;
  const stats = $('uploadStats');
  stats.hidden = false;

  function update(finished = false) {
    const now = performance.now();
    const elapsed = (now - started) / 1000;
    const processed = processedCount(report);
    const parts = [count(processed) + ' / ' + count(files.length) + ' processed'];
    const rate = finished ? confirmed / Math.max(elapsed, 0.001) : average;
    if (rate > 0) {
      const mb = rate >= 1_000_000;
      const amount = (rate / (mb ? 1_000_000 : 1_000)).toLocaleString(undefined, {maximumFractionDigits:1});
      parts.push('Average ' + amount + (mb ? ' MB/s' : ' kB/s'));
      if (!finished && !state.stop && remaining) {
        const currentETA = currentBytes / rate - (now - currentStart) / 1000;
        const nextETA = (remaining - currentBytes) / rate;
        parts.push(currentBytes && currentETA <= 0 ? 'ETA recalculating' : 'ETA ~' + duration(Math.max(0, currentETA) + nextETA));
      }
    } else if (!finished) parts.push('Measuring upload speed…');
    parts.push('Elapsed ' + duration(elapsed));
    stats.textContent = parts.join(' · ');
  }

  const tick = setInterval(update, 1000);
  return {
    start(file) {
      currentBytes = file.size;
      currentStart = performance.now();
      update();
    },
    settled(file, uploaded) {
      remaining -= file.size;
      currentBytes = 0;
      if (uploaded) {
        confirmed += file.size;
        average = confirmed / Math.max((performance.now() - started) / 1000, 0.001);
      }
    },
    finish() {
      clearInterval(tick);
      update(true);
    }
  };
}

const uploadPath = file => file.webkitRelativePath || file.name;
const uploadKey = file => JSON.stringify([uploadPath(file), file.size, file.lastModified]);
const waitingUploads = [];
let pausedUpload;

function renderUploadQueue() {
  $('queuedUploads').hidden = waitingUploads.length === 0;
  $('continueUploads').hidden = !pausedUpload;
  $('continueUploads').disabled = state.busy || state.loading || state.uploadRunning || Boolean(state.reorder);
  const unsent = pausedUpload?.recovery?.files.length;
  $('queuedUploadStatus').textContent = pausedUpload ?
    (unsent ? 'Paused. Resuming sends ' + count(unsent) + ' unsent from the previous batch first.' : 'Paused. Review activity before continuing.') :
    'Batches start in order. Each keeps its own album and upload settings.';
  $('queuedUploadList').innerHTML = waitingUploads.map(({files, settings}, index) => {
    const destination = settings.newAlbum?.title || state.albums.find(a => a.id === settings.albumId)?.title ||
      (settings.albumId ? 'Selected album' : 'No album');
    return `<li><span>${count(files.length)} ${files.length === 1 ? 'photo' : 'photos'} · ${esc(destination)}</span><button class="button subtle" data-remove-batch="${index}" type="button">Remove batch</button></li>`;
  }).join('');
}

async function drainUploads() {
  if (state.uploadRunning || state.busy || pausedUpload) return;
  state.uploadRunning = true;
  try {
    while (waitingUploads.length && !pausedUpload) {
      const {files, settings} = waitingUploads.shift();
      const report = await startUpload(files, settings);
      if (report && (report.recovery ||
        (waitingUploads.length && (state.stop || report.unknown || report.albumCreateUnconfirmed)))) {
        pausedUpload = report;
      }
    }
  } finally {
    state.uploadRunning = false;
    render();
  }
}

function queueUpload(files, settings) {
  waitingUploads.push({files, settings});
  renderUploadQueue();
  void drainUploads();
}

function resumeUploads() {
  if (state.uploadRunning || state.busy || state.loading || !pausedUpload) return;
  if (pausedUpload.recovery) {
    waitingUploads.unshift(pausedUpload.recovery);
    pausedUpload.recovery = null;
  }
  pausedUpload = null;
  void drainUploads();
}

function startUpload(files, settings) {
  let createdAlbumId;
  return runWork('Upload photos', files.length, async report => {
    const destinationId = await uploadQueue(files, report, settings);
    if (settings.newAlbum && destinationId) {
      createdAlbumId = destinationId;
      $('query').value = '';
      $('filter').value = '';
    }
  }, () => createdAlbumId);
}

async function uploadQueue(files, report, settings) {
  let {albumId} = settings;
  const {newAlbum, description, privacy, encodedTags, avoidDuplicates, skipNames} = settings;
  const meter = uploadMeter(files, report);
  let nextIndex = 0;
  let canResume = true;
  let repeatedNames = settings.repeatedNames;
  try {
    const matchedNames = new Set();
    if (skipNames && albumId) {
      workProgress('Checking filenames in the destination album…', 0, report.total);
      const counts = new Map();
      for (const file of files) counts.set(file.name, (counts.get(file.name) || 0) + 1);
      repeatedNames ??= new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
      const album = await api('/api/album?id=' + encodeURIComponent(albumId)).catch(error => {
        throw Error('Could not check filenames in the destination album. No photos were sent. ' + error.message);
      });
      for (const photo of album.photo) {
        const name = plain(photo.title);
        if (counts.has(name) && !repeatedNames.has(name)) matchedNames.add(name);
      }
    }
    while (nextIndex < files.length) {
      if (state.stop) break;
      const file = files[nextIndex++];
      const path = uploadPath(file);
      const processed = processedCount(report);
      if (matchedNames.has(file.name)) {
        report.duplicates++;
        report.issues.push(path + ' · skipped because the destination already has this exact filename.');
        meter.settled(file, false);
        continue;
      }
      workProgress('Uploading ' + path, processed, report.total);
      meter.start(file);
      const body = new FormData();
      body.set('photo', file);
      body.set('title', file.name);
      body.set('privacy', privacy);
      if (description) body.set('description', description);
      if (encodedTags) body.set('tags', encodedTags);
      if (avoidDuplicates) body.set('dedup', '1');
      let uploaded;
      try {
        uploaded = await api('/api/upload', body);
        if (uploaded.duplicate) {
          report.duplicates++;
          report.issues.push(path + ' · skipped because Flickr detected a duplicate.');
          meter.settled(file, false);
          continue;
        }
        if (!uploaded.id) throw Error('Flickr did not return a photo ID.');
      } catch (error) {
        meter.settled(file, false);
        if (error.httpStatus >= 400 && error.httpStatus < 500) {
          report.failed++;
          report.issues.push(path + ' · ' + error.message);
          continue;
        }
        report.unknown++;
        report.issues.push(path + ' · upload unconfirmed. Flickr may have received this photo. Refresh the library and check before retrying it. ' + error.message);
        break;
      }
      if (newAlbum && !albumId) {
        workProgress('Creating “' + newAlbum.title + '”', processed, report.total);
        try {
          const album = await api('/api/albums', {action:'create', ...newAlbum, photoIds:[uploaded.id]});
          if (!album.id) throw Error('Flickr did not return an album ID.');
          albumId = String(album.id);
        } catch (error) {
          canResume = false;
          report.albumCreateUnconfirmed = true;
          report.issues.push(path + ' uploaded as photo ' + uploaded.id +
            '. Could not confirm creation of “' + newAlbum.title + '”, so the remaining uploads were skipped. ' +
            'Check Albums and Not in an album before retrying. ' + error.message);
          report.done++;
          meter.settled(file, true);
          break;
        }
      } else if (albumId) {
        workProgress('Adding ' + path + ' to the album', processed, report.total);
        try {
          const result = await api('/api/organize', {action:'add', albumId, photoIds:[uploaded.id]});
          if (result.done !== 1) throw Error((result.errors || []).join(' ') || 'Album filing was unconfirmed.');
        } catch (error) {
          report.issues.push(path + ' · uploaded as photo ' + uploaded.id + ', but album filing was not confirmed. Add the existing photo to the album. ' + error.message);
        }
      }
      report.done++;
      meter.settled(file, true);
    }
  } finally {
    if (canResume && nextIndex < files.length) {
      report.recovery = {files:files.slice(nextIndex), settings:{...settings, repeatedNames, albumId, newAlbum:albumId ? null : newAlbum}};
    }
    meter.finish();
  }
  return albumId;
}

function uploader(destination = state.albumId ? 'existing' : 'none') {
  if (!state.connected) return connectPrompt();
  let queue = [];
  const waiting = state.uploadRunning || Boolean(pausedUpload);
  dialog('Upload photos', `<div class="upload-layout">
    <section class="upload-files" aria-labelledby="uploadFilesTitle">
      <h3 id="uploadFilesTitle">Files</h3>
      <div class="drop upload-sources" id="drop">
        <label class="button upload-picker">Choose files<input id="uploadFiles" type="file" accept="image/*" multiple></label>
        <label class="button upload-picker">Choose folder<input id="uploadFolder" type="file" webkitdirectory multiple></label>
        <small>Drop images here or choose a folder to include its subfolders. Up to 100 MB per image.</small>
      </div>
      <p id="queueCount" role="status">No files selected.</p><ul id="queueList" class="queue" hidden></ul>
    </section>
    <section class="upload-options">
      <fieldset class="upload-destination">
        <legend>Destination</legend>
        <div class="destination-options">
          <label><input type="radio" name="destination" value="existing" ${destination === 'existing' ? 'checked' : ''} ${state.albums.length ? '' : 'disabled'}> Existing album</label>
          <label><input type="radio" name="destination" value="new" ${destination === 'new' ? 'checked' : ''}> New album</label>
          <label><input type="radio" name="destination" value="none" ${destination === 'none' ? 'checked' : ''}> No album</label>
        </div>
      </fieldset>
      <fieldset class="upload-fields" id="uploadExisting" aria-label="Existing album">
        ${albumField({defaultId:state.albumId})}
        <label class="remember"><input type="checkbox" name="skipNames"> Skip filenames already in this album</label>
        <small>Matches Flickr titles. Leave this off if different photos share a filename.</small>
      </fieldset>
      <fieldset class="upload-fields" id="uploadNew" aria-label="New album">
        <label>Album name<input name="albumTitle" maxlength="200" required></label>
        <label>Album description <small>Optional</small><textarea name="albumDescription" rows="2" maxlength="10000"></textarea></label>
        <small>The first photo that uploads successfully becomes the album cover.</small>
      </fieldset>
      ${privacyField('private')}
      <label class="remember"><input type="checkbox" name="avoidDuplicates" checked> Skip duplicates detected by Flickr</label>
      <details class="photo-details"><summary>Photo details</summary>
        <div class="upload-fields">${descriptionField('')}${tagsField([])}</div>
      </details>
    </section>
  </div>`,
  'Start upload', async form => {
    if (!queue.length) throw Error('Choose at least one image.');
    const files = queue.slice();
    const mode = form.get('destination');
    const albumId = mode === 'existing' ? form.get('album') : '';
    const newAlbum = mode === 'new' ? {
      title: form.get('albumTitle').trim(),
      description: form.get('albumDescription')
    } : null;
    if (newAlbum && !newAlbum.title) throw Error('Enter an album name.');
    if (mode === 'existing' && !albumId) throw Error('Choose an album.');
    const description = form.get('description');
    const privacy = form.get('privacy');
    const tags = parseTags(form.get('tags'));
    if (tags.length > 75 || tags.some(tag => tag.length > 200 || tag.includes('"'))) {
      throw Error('Use up to 75 tags, with at most 200 characters and no double quotes per tag.');
    }
    const encodedTags = tags.map(tag => /\s/.test(tag) ? '"' + tag + '"' : tag).join(' ');
    modal.close();
    queueUpload(files, {albumId, newAlbum, description, privacy, encodedTags,
      avoidDuplicates:form.has('avoidDuplicates'), skipNames:form.has('skipNames')});
  }, true);
  function updateDestination() {
    const mode = $('dialogForm').elements.destination.value;
    $('uploadExisting').disabled = $('uploadExisting').hidden = mode !== 'existing';
    $('uploadNew').disabled = $('uploadNew').hidden = mode !== 'new';
    $('submitDialog').textContent = waiting ? 'Queue upload' : mode === 'new' ? 'Create album and upload' : 'Start upload';
  }
  for (const option of $('dialogForm').elements.destination) option.onchange = updateDestination;
  updateDestination();
  if (destination === 'new') $('uploadNew').querySelector('input').focus();
  const fileInput = $('uploadFiles');
  function enqueue(files) {
    const added = [...files].filter(file => file.type.startsWith('image/') && file.size > 0 && file.size <= 100 * 1024 * 1024);
    const queuedKeys = new Set(queue.map(uploadKey));
    for (const file of added) {
      const key = uploadKey(file);
      if (queuedKeys.has(key)) continue;
      queuedKeys.add(key);
      queue.push(file);
    }
    $('queueCount').textContent = count(queue.length) + ' queued' + (added.length < files.length ? ' · Some files were unsupported or too large.' : '');
    $('queueList').innerHTML = queue.map((file, index) => `<li><span>${esc(uploadPath(file))}</span><button class="button subtle" type="button" data-unqueue="${index}" aria-label="Remove ${esc(uploadPath(file))}">Remove</button></li>`).join('');
    $('queueList').hidden = !queue.length;
  }
  $('queueList').onclick = event => {
    const button = event.target.closest('[data-unqueue]');
    if (button) { queue.splice(Number(button.dataset.unqueue), 1); enqueue([]); }
  };
  for (const input of [fileInput, $('uploadFolder')]) {
    input.onchange = () => { enqueue(input.files); input.value = ''; };
  }
  const drop = $('drop');
  drop.ondragover = event => { event.preventDefault(); drop.classList.add('dragging'); };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = event => { event.preventDefault(); drop.classList.remove('dragging'); enqueue(event.dataTransfer.files); };
}

for (const action of ['add','move','remove','delete']) $(action).onclick = () => photoAction(action);
$('changeVisibility').onclick = changeVisibility;
$('newAlbum').onclick = $('createSelected').onclick = () => editAlbum();
$('editAlbum').onclick = () => editAlbum(currentAlbum());
$('reorderAlbum').onclick = reorderAlbum;
$('cancelGridOrder').onclick = cancelGridOrder;
$('saveGridOrder').onclick = saveGridOrder;
$('moveGridTop').onclick = () => moveGridSelectionToEdge(true);
$('moveGridBottom').onclick = () => moveGridSelectionToEdge(false);
$('resetGridOrder').onclick = () => {
  const draft = state.reorder;
  if (!draft || draft.saving) return;
  draft.photos = state.albumPhotos.slice();
  draft.message = draft.error = '';
  $('gridAlbumOrder').value = 'manual';
  render();
  $('gridAlbumOrder').focus();
};
$('clearGridSelection').onclick = () => {
  if (!state.reorder || state.reorder.saving) return;
  state.selected.clear();
  render();
  $('gridAlbumOrder').focus();
};
$('gridAlbumOrder').onchange = event => {
  const draft = state.reorder;
  const order = event.target.value;
  if (!draft || draft.saving || order === 'manual') return;
  if (order === 'title') draft.photos.sort((a,b) => a.title.localeCompare(b.title, undefined, {numeric:true}));
  else {
    const direction = order === 'newest' ? -1 : 1;
    draft.photos.sort((a,b) => Number(!a.uploaded) - Number(!b.uploaded) || direction * (a.uploaded - b.uploaded));
  }
  draft.message = draft.error = '';
  render();
};
$('setAlbumCover').onclick = setAlbumCover;
$('upload').onclick = () => uploader();
$('continueUploads').onclick = resumeUploads;
$('queuedUploadList').onclick = event => {
  const button = event.target.closest('[data-remove-batch]');
  if (!button) return;
  waitingUploads.splice(Number(button.dataset.removeBatch), 1);
  renderUploadQueue();
};
$('credentialSettings').onclick = credentialSettings;
$('connect').onclick = async () => {
  if (!state.connected) return connectPrompt();
  try { await api('/api/disconnect', {}); location.reload(); }
  catch (error) { showNotice(error.message); }
};
$('refresh').onclick = async () => {
  if (state.busy || state.loading) return;
  resetSelection();
  try { await refreshLibrary(); } catch (error) { showNotice(error.message); }
};
$('activity').onclick = () => {
  const report = pausedUpload || state.activity;
  if (!report || state.busy || state.loading) return;
  const resume = report.recovery;
  dialog(report.label, '<p>' + esc(summary(report)) + '</p>' +
    (report.issues.length ? '<ul class="queue">' + report.issues.map(issue => '<li>' + esc(issue) + '</li>').join('') + '</ul>' : '') +
    (resume ? '<p>Resume sends only the photos that never went to Flickr. Keep this tab open to retain the files.</p>' : '') +
    '<div class="row"><button class="button" type="button" id="activityRefresh">Refresh library</button>' +
    (resume ? '<button class="button" type="button" id="discardUnsent">Discard unsent</button>' : '') +
    '<span role="status" id="activityRefreshStatus"></span></div>',
  resume ? 'Resume ' + count(resume.files.length) + (resume.files.length === 1 ? ' unsent photo' : ' unsent photos') : '',
  () => {
    modal.close();
    resumeUploads();
  });
  if (resume) $('discardUnsent').onclick = () => {
    report.recovery = null;
    if (!waitingUploads.length) pausedUpload = null;
    renderUploadQueue();
    $('activity').click();
  };
  $('activityRefresh').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = $('submitDialog').disabled = true;
    if (resume) $('discardUnsent').disabled = true;
    $('activityRefreshStatus').textContent = 'Refreshing…';
    try {
      await refreshLibrary();
      if (button.isConnected) $('activityRefreshStatus').textContent = 'Library refreshed.';
    } catch (error) {
      if (button.isConnected) $('activityRefreshStatus').textContent = error.message;
    } finally {
      if (button.isConnected) {
        button.disabled = $('submitDialog').disabled = false;
        if (resume) $('discardUnsent').disabled = false;
      }
    }
  };
};
$('stopWork').onclick = () => { state.stop = true; $('stopWork').disabled = true; $('stopWork').textContent = 'Stopping…'; };
$('albumSearch').oninput = drawAlbums;
$('toggleAlbums').onclick = () => {
  const expanded = document.querySelector('.sidebar').classList.toggle('albums-open');
  $('toggleAlbums').setAttribute('aria-expanded', String(expanded));
};
$('albumNav').onclick = event => {
  const album = event.target.closest('[data-album]');
  if (album) browse('all', album.dataset.album);
};
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => browse(button.dataset.view);
$('query').oninput = $('filter').onchange = () => { resetSelection(); render(); };
$('sort').onchange = () => { state.limit = pageSize; render(); };
$('loadMore').onclick = () => {
  const previous = state.limit;
  state.limit += pageSize;
  render();
  $('grid').querySelectorAll('.thumb')[previous]?.focus();
};
$('clear').onclick = () => { state.selected.clear(); render(); $('selectMatching').focus(); };
$('selectMatching').onclick = () => {
  const clear = state.matches.every(photo => state.selected.has(photo.id));
  state.selected = new Set(clear ? [] : state.matches.map(p => p.id));
  render();
};
$('grid').onchange = event => {
  const input = event.target.closest('[data-select]');
  if (!input || state.busy) return;
  if (input.checked) state.selected.add(input.dataset.select);
  else state.selected.delete(input.dataset.select);
  if (state.reorder) {
    render();
    $('grid').querySelector('[data-select="' + CSS.escape(input.dataset.select) + '"]')?.focus({preventScroll:true});
    return;
  }
  input.closest('.card').classList.toggle('selected', input.checked);
  renderSelection();
};
$('grid').onclick = event => {
  if (state.reorder) {
    const step = event.target.closest('[data-grid-step]');
    if (step) stepGridPhoto(step);
    return;
  }
  const button = event.target.closest('[data-preview]');
  if (button) preview(button.dataset.preview);
};

$('grid').ondragstart = event => {
  if (!state.reorder) return;
  const card = event.target.closest('[data-reorder-id]');
  if (!card || state.reorder.saving) return event.preventDefault();
  draggingThumbnail = card.dataset.reorderId;
  event.dataTransfer.setData('application/x-flickr-manager-order', draggingThumbnail);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('is-dragging');
};
document.addEventListener('dragenter', event => { if (draggingThumbnail) event.preventDefault(); });
document.addEventListener('dragover', event => {
  if (!state.reorder || !draggingThumbnail || state.reorder.saving) return;
  const x = event.clientX, y = event.clientY;
  const bounds = $('grid').getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < 0 || y >= window.innerHeight) {
    stopGridScroll();
    clearThumbnailDrop();
    return;
  }
  event.preventDefault();
  gridDragPoint = {x, y};
  event.dataTransfer.dropEffect = markThumbnailDrop(gridDragPoint) ? 'move' : 'none';
  if (!gridScrollSpeed(gridDragPoint)) stopGridScroll();
  else if (!gridScrollFrame) gridScrollFrame = requestAnimationFrame(scrollGridDuringDrag);
});
$('grid').ondrop = event => {
  if (!state.reorder || !draggingThumbnail || state.reorder.saving) return;
  event.preventDefault();
  const card = event.target.closest('[data-reorder-id]');
  const id = draggingThumbnail;
  endGridDrag();
  if (card) moveGridPhotos(id, card.dataset.reorderId, beforeGridThumbnail(event.clientX, card));
};
$('grid').ondragend = endGridDrag;
document.addEventListener('drop', () => { if (draggingThumbnail) endGridDrag(); });
document.addEventListener('dragleave', event => {
  if (!draggingThumbnail || event.relatedTarget ||
      (event.clientX > 0 && event.clientX < window.innerWidth && event.clientY > 0 && event.clientY < window.innerHeight)) return;
  stopGridScroll();
  clearThumbnailDrop();
});
window.addEventListener('blur', stopGridScroll);

drawAlbums();
render();
if (location.protocol !== 'file:') {
  api('/api/status').then(async status => {
    state.configured = status.configured !== false;
    state.bulkVisibility = status.bulkVisibility === true;
    state.albumReorder = status.albumReorder === true;
    state.albumCover = status.albumCover === true;
    state.canRemember = Boolean(status.canRemember);
    state.remembered = Boolean(status.remembered);
    state.credentialWarning = Boolean(status.credentialWarning);
    if (state.remembered) $('accountHint').textContent = 'API credentials saved';
    state.connected = Boolean(status.connected);
    state.canDelete = Boolean(status.canDelete);
    if (!state.connected) return;
    state.library.clear();
    state.albums = [];
    state.unfiled.clear();
    state.albumId = '';
    state.albumPhotos = [];
    resetSelection();
    drawAlbums();
    document.body.classList.add('connected');
    $('accountName').textContent = status.name || 'Flickr account';
    $('accountHint').textContent = 'Flickr connected';
    $('connect').textContent = 'Disconnect';
    $('refresh').hidden = false;
    try { await refreshLibrary(); } catch (error) {
      state.library.clear();
      state.albums = [];
      state.unfiled.clear();
      drawAlbums();
      render();
      showNotice(error.message);
    }
  }).catch(error => showNotice(error.message));
}
