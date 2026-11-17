# Flickr Manager

A portable Windows app by Zac Morgan for organizing a Flickr library from your browser.

## Why I built it

Flickr's web search can find albums by name and photos in my photostream. The individual album view lacks a search field for photo titles. [Flickr's search guide](https://www.flickrhelp.com/hc/en-us/articles/4404058806420-Search-Flickr-to-find-photos-people-or-groups)

I built Flickr Manager so I could open a large album, type part of a photo title, and work with the matching thumbnails in the same view. I can then select the matches to move them, remove them from the album, or change their order.

## Get started

1. Download the [portable Windows x64 ZIP](https://github.com/zzm6899/flickr-manager/releases/latest/download/Flickr-Manager-Windows-x64.zip) and extract the whole folder.
2. Double-click **Start Flickr Manager.cmd**. Keep its window open while using the app.
3. Click **Log in to Flickr**, enter your own Flickr API key and secret, then authorize the app on Flickr. You can [find your existing keys](https://www.flickr.com/services/apps/by/me) or [request a key](https://www.flickr.com/services/api/keys/).

The ZIP includes Node.js. To run a source checkout, install [Node.js 22 or newer](https://nodejs.org/en/download) on your PATH and use the same launcher. There are no npm dependencies.

## What you can do

- Search albums and photo titles, browse thumbnails, and find photos that aren't in any album.
- Create albums, set album covers, and add, move, or remove photos in bulk.
- Drag to reorder thumbnails, or move selected photos to the top or bottom while keeping their relative order. Click **Save album order** to apply the draft.
- Queue files or folders with subfolders. Upload into an existing album or create one during upload. See speed and time estimates and resume files the queue never sent.
- Edit titles, descriptions, tags, and visibility. Permanent photo deletion uses separate Flickr authorization.

The app listens on your PC. **Remember on this PC** saves your API credentials encrypted for your Windows user. Your Flickr password is entered on Flickr's website. See [README.txt](README.txt) for details.

This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc.
