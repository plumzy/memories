# Anniversary Memory Gallery

A full PWA anniversary memory gallery served by Express, with Supabase metadata, Cloudflare R2 media storage, image compression, fullscreen viewing, carousel modes, captions, folders, and Google Photos Picker import.

## Structure

```text
/
  index.html
  style.css
  script.js
  manifest.webmanifest
  sw.js
  /assets
  /server
    server.js
    /routes
      media.js
      photos.js
    /services
      r2.js
      supabase.js
      compression.js
  /supabase
    schema.sql
  package.json
  README.md
```

## Setup

1. Run the SQL in `supabase/schema.sql` in the Supabase SQL editor.
2. Copy `.env.example` to `.env`.
3. Fill `.env` with your real values. Do not commit `.env`.
4. Install dependencies:

```bash
npm install
```

5. Start locally:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Required Environment Variables

```bash
PORT=3000
APP_BASE_URL=https://memories-l394.onrender.com
APP_USER_ID=anniversary
SESSION_SECRET=replace-with-a-long-random-secret

SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=memories
R2_PUBLIC_BASE_URL=https://pub-17ec66682d9e4c59b4ce33433540f470.r2.dev

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://memories-l394.onrender.com/api/google-photos/callback
```

## Google OAuth Redirect URI

Use the Render backend callback as the OAuth redirect URI:

```text
https://memories-l394.onrender.com/api/google-photos/callback
```

The GitHub Pages URL is not a correct redirect target for this architecture because the OAuth code exchange uses the backend and the client secret must never be exposed in browser files.

## R2 Public URL

`R2_PUBLIC_BASE_URL` must be a public object-serving domain that maps directly to object keys. For this project, use:

```text
https://pub-17ec66682d9e4c59b4ce33433540f470.r2.dev
```

The S3 API endpoint usually requires credentials and should not be used as the browser image URL unless you have separately configured it for public access.

The app stores objects using:

```text
users/{userId}/folders/{folderId}/{fileName}
```

Thumbnails are stored beside originals with `-thumb.jpg`.

## Render Deployment

Create a Render Web Service from this repo.

- Build command: `npm install`
- Start command: `npm start`
- Runtime: Node 20+
- Add all environment variables in Render dashboard

After deploying, update Google Cloud OAuth to include:

```text
https://memories-l394.onrender.com/api/google-photos/callback
```

## Features

- Installable PWA with offline app shell
- Express serves static frontend and `/api` routes
- Upload, delete, move, list media
- Multi-select gallery management
- Caption and optional author editing
- Fullscreen swipe viewer
- Auto-rotating carousel with pause/play
- Carousel modes: all photos, current folder cycle, selected photos
- Backend image compression at 65-70% quality
- Thumbnail generation
- Cloudflare R2 upload/delete
- Supabase metadata tables
- Google Photos OAuth + Picker session + import flow

## Security Notes

- Keep `.env` out of git.
- Never put the Supabase service role key in frontend files.
- Never put R2 access keys in frontend files.
- The browser only calls safe Express endpoints.
- The Supabase anon key is listed for completeness, but this app uses server-side Supabase access for gallery operations.
