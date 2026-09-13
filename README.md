# Old Google by Audrey Lo

---

If you hate the AI overviews in Google as much as I do, I made a Chrome extension that removes them. It also does some other cool things:

- Brings back the dictionary and synonym previews
- Expands the emoji picker so looking up "crying emoji" lets you copy it
- Removes sponsored results

---

The preview at the top of the results is a real featured snippet again: one passage quoted verbatim from one website, with that site's name and link underneath. The extension fetches the top result's page, scores its paragraphs, lists and tables against your query with a small local question-answering model, and shows the best one, so nothing is generated and nothing leaves your machine.

## Installation

1. Clone this repository:

   ```sh
   git clone https://github.com/audrlo/old-google.git
   cd old-google
   ```

2. Fetch the model that ranks the preview passages. It is about 200 MB, so it is downloaded rather than kept in the repository:

   ```sh
   ./tools/fetch-model.sh
   ```

3. Open `chrome://extensions` in Chrome, or the equivalent in Edge, Brave, Arc or any other Chromium browser.
4. Turn on **Developer mode** in the top right.
5. Click **Load unpacked** and pick the `old-google` folder.
6. Search for something on google.com.

Click the extension's toolbar icon to change settings.
