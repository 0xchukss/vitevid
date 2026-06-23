# ViteVid

<img width="525" height="373" alt="image" src="https://github.com/user-attachments/assets/2595ad24-f0ac-40b0-8e3b-9858695ae91d" />






[![ViteVid](https://img.shields.io/badge/ViteVid-Video_Automation-ff69b4.svg?style=flat-square)](#) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

ViteVid is a full video automation application that takes your voiceover and automatically edits a complete video around it. It generates storyboards, scrapes clips, and automatically applies sound effects, background music, captions, and pacing tailored to your specific YouTube niche.

## Workflow

1. **Attach Voiceover**: Upload or link your voiceover track.
2. **Select YT Niche**: Choose your target YouTube niche so the app can tailor the assets and pacing.
3. **Editing Instructions**: Provide specific instructions for how you want the video edited.

## How it Works

Once you've provided the inputs, the application:
- Transcribes the voiceover automatically.
- Generates a scene-by-scene storyboard.
- Determines the ideal pacing for each scene based on the selected niche.
- Scrapes relevant video clips.
- Opens the Video Lab interface.
- Automatically edits the video according to your instructions in under 5 minutes (even tested for 50-minute long videos!).
- Exports the final video using server-side FFmpeg (localhost).
- Downloads the finished product directly to your machine.

*Note: The app automatically attaches niche-appropriate sound effects, captions, background music, and handles the pacing for you.*

## Local Setup

ViteVid is optimized for local development and requires a Node.js environment to handle server-side rendering and local file system exports (like saving the final video directly to your PC using FFmpeg).

1. **Clone the repository**:
   ```bash
   git clone https://github.com/0xchukss/vitevid.git
   cd vitevid
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure API Keys** (Optional but recommended for higher rate limits on clip scraping):
   Create a `.env.local` file and add your keys:
   ```env
   SMITHSONIAN_API_KEY=your_key
   PEXELS_API_KEY=your_key
   PIXABAY_API_KEY=your_key
   GOOGLE_API_KEY=your_key
   GOOGLE_CX=your_cx
   ```

4. **Run Locally**:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

## Deployment Note

- **Hosted Environments (Vercel)**: While you can deploy the interface to Vercel, the local FFmpeg rendering and direct file system interactions (saving to your PC) are designed for local environments.

## License

This project is licensed under the MIT License.
