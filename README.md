# ViteVid

<img width="752" height="534" alt="image" src="https://github.com/user-attachments/assets/8ef64d5e-6a28-4164-86b0-11fb47760e6c" />





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

## Local Setup Guide

### Install requirements
- Install Node.js 20+
- Install Git

*No separate FFmpeg install is needed because the app uses `ffmpeg-static`.*

### Clone the project
```bash
git clone <vitevid-repo-url>
cd vitevid
```
*If the folder name has spaces, use quotes:*
```bash
cd "C:\Users\Hp\Downloads\media scraper"
```

### Install dependencies
```bash
npm install
```

### Create .env.local
In the project root, create a `.env.local` file:
```env
# Transcription provider, recommended
DEEPGRAM_API_KEY=your_deepgram_key
DEEPGRAM_MODEL=nova-3
DEEPGRAM_BASE_URL=https://api.deepgram.com/v1

# Optional OpenAI transcription fallback
OPENAI_API_KEY=your_openai_key
OPENAI_WHISPER_API_KEY=your_whisper_key
OPENAI_WHISPER_BASE_URL=https://api.openai.com/v1
OPENAI_WHISPER_MODEL=whisper-1

# Claude / storyboard / edit planning
CLAUDE_STORYBOARD_API_KEY=your_claude_or_gateway_key
CLAUDE_STORYBOARD_BASE_URL=https://api.freemodel.dev/v1
CLAUDE_STORYBOARD_MODEL=claude-opus-4-7
CLAUDE_STORYBOARD_FALLBACK_MODEL=sonnet 4.6

CLAUDE_EDIT_API_KEY=your_claude_or_gateway_key
CLAUDE_EDIT_BASE_URL=https://api.freemodel.dev/v1
CLAUDE_EDIT_MODEL=sonnet 4.6

# Optional Reddit true-crime research
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret
REDDIT_USER_AGENT=ViteVidLocal/1.0 by your_username

# Optional Remotion export path
VITEVID_USE_REMOTION_EXPORT=1
```
*Do not commit `.env.local`.*

### Run the dev server
```bash
npm run dev
```

### Open the app
Go to: `http://localhost:3000`

### Normal workflow
1. Open Auto Storyboard
2. Attach voiceover
3. Select niche
   - *For true crime, enter case title and day/night case time*
4. Click Build from voiceover
5. Review/rematch scenes
6. Open Video Lab
7. Export and download

### Production local run
```bash
npm run build
npm run start
```

### Important Notes
- DDG, Bing, and Yahoo media search do not need API keys.
- Deepgram or OpenAI is needed for transcription.
- Claude keys are needed for best storyboard/media/edit planning; without them, some fallback logic may work, but quality drops.
- Keep `public/background-music` and `public/sound-effects` included, because the auto music/SFX system depends on those files.

## Deployment Note

- **Hosted Environments (Vercel)**: While you can deploy the interface to Vercel, the local FFmpeg rendering and direct file system interactions (saving to your PC) are designed for local environments.

## License

This project is licensed under the MIT License.
