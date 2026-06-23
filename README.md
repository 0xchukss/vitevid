# ViteVid

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

ViteVid is a high-performance web tool for instantly searching, trimming, and downloading public domain media for YouTube video automation.

## Features
- **Media Aggregator**: Search from multiple sources including Prelinger Archives, Library of Congress, Smithsonian, Google, Pexels, and Pixabay.
- **Precision Trimming**: Centered dual-handle slider for frame-accurate clipping.
- **Direct PC Download**: Saves assets directly to your system's `Downloads/VintageAssets` folder.
- **Workflow Optimization**: Drag-and-drop support for CapCut and one-click "Copy Path" buttons.

## Local Setup

ViteVid is optimized for local development and requires a Node.js environment to enable local file system interactions (like saving directly to your PC).

1. **Clone the repository**:
   ```bash
   git clone https://github.com/0xchukss/vitevid.git
   cd vitevid
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure API Keys** (Optional but recommended for higher rate limits):
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

- **Hosted Environments (Vercel)**: While you can deploy the search interface to Vercel, the local file system interactions (saving directly to your PC) will be disabled. In a hosted environment, you should use standard browser downloads.

## License

This project is licensed under the MIT License.
