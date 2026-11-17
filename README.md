# Flickr Manager

A portable Windows app by Zac Morgan for organizing a Flickr library from your browser.

## Why I built it

I can use Flickr's search to find albums by name or photos in my photostream. Once I open an album, there's no field to search for photo titles. [Flickr's search guide](https://www.flickrhelp.com/hc/en-us/articles/4404058806420-Search-Flickr-to-find-photos-people-or-groups)

I built Flickr Manager so I could type part of a photo title in a large album and see the matching thumbnails. From there I can select photos to move, remove from the album, or reorder.

## Get started

1. Download the [portable Windows x64 ZIP](https://github.com/zzm6899/flickr-manager/releases/latest/download/Flickr-Manager-Windows-x64.zip) and extract the whole folder.
2. Double-click **Start Flickr Manager.cmd**. Keep its window open while using the app.
3. Click **Log in to Flickr**, enter your own Flickr API key and secret, then authorize the app on Flickr. You can [find your existing keys](https://www.flickr.com/services/apps/by/me) or [request a key](https://www.flickr.com/services/api/keys/).

The ZIP includes Node.js. To run a source checkout, install [Node.js 22 or newer](https://nodejs.org/en/download) on your PATH and use the same launcher. There are no npm dependencies.

## What you can do

- Search albums and photo titles, browse thumbnails, and find photos that aren't in any album.
- Create albums, set album covers, and add, move, or remove photos in bulk.
- Drag to reorder thumbnails, or move selected photos to the top or bottom while keeping their relative order. Click **Save album order** to apply the draft.
- Queue files or folders, including subfolders. Upload to an existing album or create one during upload. The queue shows upload speed and estimated time remaining. If an upload stops, you can resume the files the queue never sent.
- Edit titles, descriptions, tags, and visibility. Permanent photo deletion uses separate Flickr authorization.

The app listens only on your PC. **Remember on this PC** encrypts saved API credentials for your Windows user. Enter your Flickr password on Flickr's website. See [README.txt](README.txt) for details.

This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc.
