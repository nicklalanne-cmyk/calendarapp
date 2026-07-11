# Cadence — finish deploying (Supabase is already done)

I created and configured the database for you. What's left is the Vercel deploy and the
OAuth wiring, which live in dashboards/CLI I can't drive end-to-end. Values you'll need are below.

## Already done (by me)
- Supabase project **Cadence** is live, schema + row-level security applied.
- **Project URL:** https://sltdozphjepdstuazhra.supabase.co
- **anon (public) key:** in `.env.production` in this bundle (safe to expose; it's the browser key).

## 1) Deploy to Vercel (no git needed, ~1 min)
In the `cadence-web` folder:
```
npx vercel login
npx vercel --prod
```
Accept the defaults (it auto-detects Next.js). Copy the deployment URL it prints
(e.g. `https://cadence-xxxx.vercel.app`).

## 2) Set env vars in Vercel, then redeploy
Project -> Settings -> Environment Variables (Production), add all four:

| Name | Value |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | https://sltdozphjepdstuazhra.supabase.co |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | (the value in `.env.production`) |
| GOOGLE_CLIENT_ID | 190637457009-f7lth4dgfm6ingusbkql80osmatem96p.apps.googleusercontent.com |
| GOOGLE_CLIENT_SECRET | (your secret — the GOCSPX-… value) |

Then run `npx vercel --prod` again so they take effect.
(The two NEXT_PUBLIC values are already baked into `.env.production`, so sign-in works on the
first deploy; adding all four is what turns on calendar sync.)

## 3) Enable Google in Supabase
Supabase -> Authentication -> Providers -> **Google**: toggle on, paste the **Client ID**
and **Client secret** (same ones as above).

## 4) Supabase redirect config
Supabase -> Authentication -> URL Configuration:
- **Site URL:** your Vercel URL
- **Redirect URLs:** add `https://YOUR-APP.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`

## 5) Google Cloud OAuth client
APIs & Services -> Credentials -> your OAuth **Web** client -> **Authorized redirect URIs**, add:
```
https://sltdozphjepdstuazhra.supabase.co/auth/v1/callback
```
Also confirm: Google Calendar API enabled, your email added as a **Test user** on the consent
screen, and the scope `https://www.googleapis.com/auth/calendar` is present.

## 6) Try it
Open your Vercel URL -> **Continue with Google** -> grant Calendar access. Tasks/notes/sign-in
work immediately; your calendar loads once step 2 (the secret) is in.

## 7) Rotate the secret
Since the client secret passed through chat, reset it afterward:
Google Cloud -> Credentials -> your client -> **Reset secret**, then update it in Vercel + Supabase.
