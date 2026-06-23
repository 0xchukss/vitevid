import { ResultItem } from '../types';

export interface AutomatedSceneInput {
  id: number;
  text: string;
  asset: ResultItem;
  duration: number;
  clipStart: number;
}

export interface AutomatedClip {
  id: string;
  sceneId: number;
  title: string;
  text: string;
  type: string;
  src: string;
  poster: string;
  duration: number;
  sourceStart: number;
  motion: 'push-in' | 'pull-out' | 'pan-left' | 'pan-right';
  transition?: 'none' | 'fade' | 'slideleft' | 'slidedown' | 'screenburn' | 'glitch';
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  rightsStatus?: ResultItem['rightsStatus'];
  rightsLabel?: string;
  rightsNote?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  sourcePageUrl?: string;
  isCopyrightSafe?: boolean;
  needsRightsReview?: boolean;
}

export interface AutomatedTextOverlay {
  id: string;
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  size: number;
  color: string;
  background: string;
}

export interface AutomatedAudioTrack {
  src: string;
  start: number;
  duration: number;
  sourceStart: number;
  volume: number;
  loop?: boolean;
  sourceDuration?: number;
}

export interface AutomatedVideoProps {
  clips: AutomatedClip[];
  textOverlays: AutomatedTextOverlay[];
  audioTrack?: AutomatedAudioTrack | null;
  musicTrack?: AutomatedAudioTrack | null;
  musicTracks?: AutomatedAudioTrack[];
  soundEffects?: AutomatedAudioTrack[];
  stylePreset?: 'history-vintage' | 'true-crime-dark';
  canvasColor: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

const MOTIONS: AutomatedClip['motion'][] = ['push-in', 'pan-right', 'pull-out', 'pan-left'];

export function createAutomatedEditProject(
  scenes: AutomatedSceneInput[],
  options: Partial<Pick<AutomatedVideoProps, 'canvasColor' | 'width' | 'height' | 'fps'>> = {},
): AutomatedVideoProps {
  const fps = options.fps || 30;
  const clips = scenes.map((scene, index): AutomatedClip => {
    const motion = MOTIONS[index % MOTIONS.length];
    const isImage = scene.asset.type === 'image';
    return {
      id: `auto-scene-${scene.id}`,
      sceneId: scene.id,
      title: scene.asset.title || `Scene ${index + 1}`,
      text: scene.text,
      type: scene.asset.type,
      src: scene.asset.downloadUrl || scene.asset.thumbnail,
      poster: scene.asset.thumbnail || scene.asset.downloadUrl,
      duration: Math.max(0.5, scene.duration),
      sourceStart: scene.clipStart || 0,
      motion,
      startScale: isImage ? 104 : 100,
      endScale: motion === 'pull-out' ? 100 : 112,
      startX: motion === 'pan-left' ? 5 : motion === 'pan-right' ? -5 : 0,
      endX: motion === 'pan-left' ? -5 : motion === 'pan-right' ? 5 : 0,
      startY: index % 2 === 0 ? 0 : -2,
      endY: index % 2 === 0 ? -2 : 0,
      rotation: index % 3 === 0 ? -0.35 : index % 3 === 1 ? 0.25 : 0,
      brightness: 98,
      contrast: 112,
      saturation: 82,
      sepia: 18,
      rightsStatus: scene.asset.rightsStatus,
      rightsLabel: scene.asset.rightsLabel,
      rightsNote: scene.asset.rightsNote,
      license: scene.asset.license,
      licenseUrl: scene.asset.licenseUrl,
      attribution: scene.asset.attribution,
      sourcePageUrl: scene.asset.sourcePageUrl || scene.asset.url,
      isCopyrightSafe: scene.asset.isCopyrightSafe,
      needsRightsReview: scene.asset.needsRightsReview,
    };
  });
  const durationSeconds = clips.reduce((total, clip) => total + clip.duration, 0);

  return {
    clips,
    textOverlays: [],
    canvasColor: options.canvasColor || '#000000',
    width: options.width || 1280,
    height: options.height || 720,
    fps,
    durationInFrames: Math.max(1, Math.ceil(durationSeconds * fps)),
  };
}
