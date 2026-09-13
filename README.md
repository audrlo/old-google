# Old Google by Audrey Lo

If you hate the AI overviews in Google as much as I do, I made a Chrome extension that removes them. It also does some other cool things:

- Brings back the dictionary and synonym previews
- Expands the emoji picker so looking up "crying emoji" lets you copy it
- Removes sponsored results

To bring back the old previews, we extract the page of the top result, score its paragraphs with a small local model and shows the best one, so no content is generated and nothing leaves your machine. I use DistilBERT base uncased, distilled on SQuAD 1.1 for extractive question answering.

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
