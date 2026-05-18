# Fretboard Staff Trainer

A web-based trainer for learning where written notes lie on a 4-string fretboard.

## Features

- Learn mode and speed mode
- Staff-notation prompts instead of note-name prompts
- Selectable clef: treble, alto, tenor, or bass
- Instrument presets for violin, viola, cello, and bass
- Natural-note and chromatic training
- Configurable fret range, enabled strings, timer, and question count
- Correct answer validation by exact written pitch, including octave
- Mobile-friendly fretboard UI
- GitHub Pages deployment workflow included

## How It Works

- The app shows a single note on a five-line staff.
- The chosen clef affects how that note is rendered, but clef choice is independent from the instrument preset.
- The selected instrument preset changes the open-string tuning and displayed string labels.
- Frets still represent semitone steps, so the same fretboard UI is reused for all supported instruments.
- Answers are checked against the exact target pitch, not just the pitch class.

## Local Development

Requirements:

- Node.js 18+
- npm

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

To test on your phone over the local network:

```bash
npm run dev -- --host
```

## Build

```bash
npm run build
```

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow that deploys the app to GitHub Pages.

Steps:

1. Create a GitHub repository and push this project to the `main` branch.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` again if needed.
5. GitHub will publish the site at:

```text
https://<your-username>.github.io/<repo-name>/
```

The Vite base path is derived automatically from the GitHub repository name during the Pages build.

## Notes

- For local development, the app uses `/` as the base path.
- For GitHub Pages builds, the app uses `/<repo-name>/` automatically.
