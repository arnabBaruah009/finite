# Finite

A Manifest V3 Chrome extension that replaces the new tab page with a dark, minimal countdown for each task. Time left is shown in fractional days and ticks on every frame.

Tasks stay in `chrome.storage.local`, so they persist across tabs and browser restarts.

## Load the unpacked extension

`app.js` is already built. You can load the extension without installing anything.

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder (`finite`).
5. Open a new tab.

The page should be an empty charcoal screen with a **Tasks** control in the corner. Use it to add a title and an exact target date and time. The countdown appears on the new tab; edit and delete stay in the drawer.

If another extension also overrides the new tab, disable that one or Finite will not be the page Chrome shows.

After you change the extension files, click **Reload** on the Finite card at `chrome://extensions`, then open a fresh tab.

## Rebuild after TypeScript changes

Source lives in `src/app.ts`. Chrome runs the compiled `app.js`.

```bash
npm install
npm run build
```

Then reload the extension in `chrome://extensions`.
