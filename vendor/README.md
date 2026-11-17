# vendor

`supabase-js-2.45.4.js` is the official Supabase browser library, copied unchanged from the
npm package `@supabase/supabase-js@2.45.4` (file `dist/umd/supabase.js`).

It lives in this repo instead of being loaded from a CDN so that the page only ever runs code
that is in this repo. If a CDN were compromised, its script would run inside the admin's
signed-in session and could read pay data.

SHA-256: `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7`

To verify or update:

```bash
npm pack @supabase/supabase-js@2.45.4
tar xzf supabase-supabase-js-2.45.4.tgz
sha256sum package/dist/umd/supabase.js vendor/supabase-js-2.45.4.js
```
