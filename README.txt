Flickr Manager
==============

Start on Windows
----------------
1. Extract the whole folder. If an older Flickr Manager or Organizer is
   running, close its terminal window before launching this copy.
2. Double-click Start Flickr Manager.cmd. It opens the app in your browser.
   If your browser does not open, use the address shown in the launcher.
3. Choose Log in to Flickr. Enter your API key and masked secret in the
   browser the first time. Select Remember on this PC to reuse them later,
   then choose Continue to Flickr. Approve the app shown on Flickr's
   consent page if you recognize it.

The portable ZIP includes the official Node.js 24.22.3 Windows x64 runtime
under runtime, so no installation or npm setup is needed. If you downloaded
the source or use a different architecture, install Node.js 22 or newer
on your PATH, or place the appropriate official executable at runtime\node.exe.
Node downloads are available at https://nodejs.org/en/download.

API credentials
---------------
Find your existing key and secret at https://www.flickr.com/services/apps/by/me
Apply for a new key at https://www.flickr.com/services/api/keys/
Flickr currently requires Pro to request a key. See
https://www.flickrhelp.com/hc/en-us/articles/4404070036884-Flickr-API
Your Flickr password is entered only on Flickr's website.

Keep the launcher window open while you work. Press Ctrl+C in the launcher
or close its window when finished. The app listens only on your computer.
Remember on this PC encrypts the key and secret for your Windows user in
%LOCALAPPDATA%\Flickr Manager. They stay outside the portable folder.
Use API settings to replace them or choose Forget API credentials to
remove them. The app keeps the Flickr sign-in session in memory, so choose
Log in to Flickr again after a restart.
The launcher tries port 8765, then 8766, then a free port assigned by Windows.
If you set PORT yourself, the launcher uses only that port.

Organize, edit and upload
-------------------------
- Search albums in the sidebar. Open an album to search within it, or use
  the library and unfiled views. Use the gallery filters to narrow a batch.
- Open on Flickr opens the current album in a new tab. Reorder photos saves
  an order for the entire album. It shows every photo in the album grid
  regardless of the current filters. Drag thumbnails left or right of
  another photo, or use the up and down buttons. Drag a selected thumbnail
  to move the selection together, or use Move to top and Move to bottom to
  place the selected photos at either end. Save album order applies your draft.
  Hold a dragged thumbnail near the top or bottom of the browser window
  to scroll through the album.
- To set an album cover, open the album, select exactly one photo, and
  choose Set as album cover. The Album cover badge marks the current cover.
- Select photos to add, move, or remove them. Select all matching applies
  to every search result. A move adds to the destination first. Deleting
  an album keeps its photos in your library.
- Use a photo's preview to edit its Flickr title, description, tags and
  visibility. Enter one tag per line.
- To change visibility in bulk, select photos and choose Change visibility.
  Select all matching includes every photo in the current filter, including
  photos beyond the first page. The change applies to the photos across Flickr.
  After updating the app, restart the launcher so it loads the new controls
  and the matching server.
- In Upload photos, choose images or a folder and its subfolders. Choose an
  existing album, New album, or No album. For a new album, enter its name and
  choose Create album and upload. Flickr uses the first successful upload as
  the cover, then the rest of the batch goes into that album. The sidebar
  Create album button opens this flow if you have no selected photos.
- The queue shows relative paths. The progress panel estimates the remaining
  time and shows average speed after the first confirmed upload.
  Open View activity for errors, including photos that uploaded successfully
  but could not be added to the album.
- After an interruption, use Refresh library in View activity. Resume unsent
  photos picks up only files the queue never sent. Keep the tab open to retain
  those files. Check your Flickr library for an unconfirmed photo before
  uploading it again.
- Use Queue another upload while a batch runs. Waiting batches start in order
  with their own album and settings. If an upload is unconfirmed or you stop
  the current batch, review Activity before resuming. Waiting batches and
  unsent files stay in this tab until you close or refresh it.
- Flickr's duplicate check is on by default. When reselecting an old folder,
  you can also opt in to skipping exact filenames already in the destination
  album. Filenames shared by several files in the new queue still go through
  the upload check. Matching titles are a shortcut, so leave this off if
  different photos reuse filenames.
- Permanent photo deletion needs separate Flickr authorization. After you
  authorize, select the photos again and confirm the deletion.

Share the folder
----------------
Send the whole folder or ZIP. Recipients can use their own API credentials
and authorize their own Flickr account. Keep credentials out of anything
you share. The software needs internet access to connect to Flickr.

This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc.
