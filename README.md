# trip splitter

a dark grayscale, all-lowercase shared expense tracker for a weekend trip.

## included

- `index.html`
- `app.js`
- `config.js`
- `schema.sql`
- `manifest.json`
- `.nojekyll`

## features

- supabase database storage
- default purchaser buttons for sam, hunter, amanda, mick and rod
- add more people
- purchase info field with no placeholder text
- split between checklist
- summary by person
- suggested settle-up payments
- running list of purchases
- optional receipt uploads through supabase storage
- mobile-responsive layout
- github pages ready

## supabase setup

1. create a supabase project.
2. open supabase.
3. go to sql editor.
4. click new query.
5. paste the full contents of `schema.sql`.
6. click run.

## connect the app to supabase

open `config.js` and replace:

```js
window.TRIP_SPLITTER_CONFIG = {
  supabaseUrl: "PASTE_YOUR_SUPABASE_PROJECT_URL",
  supabaseAnonKey: "PASTE_YOUR_SUPABASE_ANON_KEY"
};
```

with your real values from:

supabase project settings > api

use:

- project url
- anon public key

do not use the service role key.

## github setup

1. create a new github repository.
2. upload all files from this folder.
3. commit to the `main` branch.

## github pages setup

1. open the repository.
2. go to settings.
3. go to pages.
4. under build and deployment, select:
   - source: deploy from a branch
   - branch: main
   - folder: /root
5. save.

your app link will look like:

```text
https://yourusername.github.io/trip-splitter/
```

## first use

1. open the github pages link.
2. create a trip.
3. the app automatically adds:
   - sam
   - hunter
   - amanda
   - mick
   - rod
4. copy the trip link.
5. share that link with the group.

## security note

this is an mvp for a friend trip. the anon public key is safe to expose, but the database policies in this version allow anonymous users to create, view, update and delete app data. anyone with a trip link can edit that trip.

for a production version, add:

- supabase auth
- invite-only trip membership
- member-based row-level security
- edit/delete permissions
