# Waterloo

Waterloo is a GitHub-Pages-friendly experimental social game platform with:

- Real email/password accounts through Supabase Auth
- Real registered-user player list
- Friend requests and friendships stored in Postgres
- 2D and 3D scene editing
- Object creation, selection, position/scale editing, and deletion
- Playable 2D platformer mode
- Playable 3D movement mode with camera dragging
- Mobile touch controls
- Published games stored in Supabase

## 1. Create the backend

Create a project at https://supabase.com/

Open **SQL Editor** and run `supabase/schema.sql`.

Then open **Project Settings → API** and copy:

- Project URL
- Publishable key (preferred; the older anon key is being phased out)

Put them in `config.js`:

```js
window.WATERLOO_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_PUBLISHABLE_KEY"
};
```

Do **not** put a `service_role` key in the browser.

## 2. Run locally

Because ES modules are used, serve the folder with a local web server instead of opening index.html directly.

Examples:

```bash
python -m http.server 8080
```

Then open:

http://localhost:8080

## 3. Publish on GitHub — easiest method

1. Go to https://github.com/ and sign in.
2. Press **+** in the top-right → **New repository**.
3. Repository name: `waterloo`
4. Choose **Public** if you are using GitHub Free.
5. Press **Create repository**.
6. Open the new empty `waterloo` repository.
7. Press **Add file → Upload files**.
8. Open the downloaded `waterloo.zip` on your device and extract it first. **Upload the contents of the `waterloo` folder**, not the outer `waterloo` folder itself.
9. Make sure `index.html` is visible directly in the repository root. You should see `index.html`, `app.js`, `styles.css`, `config.js`, `supabase/`, and `.github/`.
10. Scroll down and press **Commit changes**.

### Turn on GitHub Pages

Because this package already includes a GitHub Actions deployment workflow:

1. In the repository, open **Settings**.
2. In the left sidebar open **Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open the **Actions** tab and wait for **Deploy Waterloo to GitHub Pages** to finish with a green check.
5. Go back to **Settings → Pages** and press **Visit site**.

GitHub's current documentation confirms that a custom Actions workflow can deploy the repository to Pages, and the site URL for a normal project repository is `YOUR-USERNAME.github.io/waterloo`. Changes can take a few minutes to appear.

GitHub Pages is only the website host. Supabase is still required for Waterloo's real accounts, friends, players, games, and multiplayer backend.

## 4. JS.ORG later

After GitHub Pages works, JS.ORG allows a subdomain based on the GitHub Pages project/repository name.

For a repository named `waterloo`, you can request:

`waterloo.js.org`

JS.ORG's current process requires a CNAME/custom-domain setup and a pull request to the js-org/js.org repository. See the official JS.ORG instructions.

## Security note

The browser contains only the public Supabase key. Authentication and database access are enforced by Supabase Auth + Row Level Security. Never publish a service-role key.

## Waterloo experimental netcode
The current multiplayer prototype uses Supabase Realtime only for signaling/presence and WebRTC DataChannels for gameplay input packets. It uses a fixed-step input stream and peer election based on measured connection/device capability metadata. This is an experimental FR-Legends-style direction, not a guarantee of cross-browser bit-for-bit determinism.

For production, replace the demo physics with a deterministic fixed-point simulation compiled to WebAssembly, add a TURN service for difficult NATs, keep server-side validation for economy and sensitive game state, and test every supported browser/device combination.

## Hydro economy
The SQL schema now contains a centralized Hydro wallet and ledger plus a safe authenticated transfer RPC. The multiplayer/P2P layer never writes balances. A real 10 USD checkout still requires a payment provider (for example Stripe) and a server-side webhook/service role; the client must never grant itself paid Hydro. The schema also includes one-time promo/ledger groundwork and game-asset maturity/LOD metadata.

## Mature content and age privacy
Waterloo does not store a profile age field. However, blocking phrases such as "I am 13" is not by itself sufficient for COPPA, GDPR-K, or other child-safety compliance. Mature-content classification should combine creator declarations, access controls, server-side scanning/review, and legal/compliance requirements. Client-side scans are treated as hints, not authoritative decisions.
