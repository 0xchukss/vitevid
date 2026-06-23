import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { AutomatedClip, AutomatedTextOverlay, AutomatedVideoProps } from './automated-edit';

const HISTORY_REFERENCE_RESET_SECONDS = 2.7;

function sceneStartFrames(clips: AutomatedClip[], fps: number) {
  let cursor = 0;
  return clips.map((clip) => {
    const start = cursor;
    cursor += Math.round(clip.duration * fps);
    return start;
  });
}

function ScreenBurnTransitionLayer({ frame, fps }: { frame: number; fps: number }) {
  const burnFrames = Math.max(8, Math.round(0.58 * fps));
  const opacity = interpolate(frame, [0, Math.round(burnFrames * 0.34), burnFrames], [0.95, 0.74, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sweep = interpolate(frame, [0, burnFrames], [-28, 118], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        mixBlendMode: 'screen',
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 18% 50%, rgba(255,246,198,0.92) 0%, rgba(255,131,29,0.56) 22%, rgba(107,19,0,0.12) 48%, transparent 70%)',
          transform: `translateX(${sweep}%) scale(1.18)`,
          filter: 'blur(9px)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(255,235,161,0.68), rgba(255,91,18,0.32) 18%, transparent 42%), radial-gradient(circle at 8% 12%, rgba(255,255,255,0.75), transparent 14%)',
        }}
      />
    </AbsoluteFill>
  );
}

function GlitchTransitionLayer({ frame, fps }: { frame: number; fps: number }) {
  const glitchFrames = Math.max(6, Math.round(0.42 * fps));
  const opacity = interpolate(frame, [0, Math.round(glitchFrames * 0.7), glitchFrames], [0.7, 0.38, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const barShift = frame % 4 === 0 ? -4 : frame % 4 === 1 ? 6 : frame % 4 === 2 ? -2 : 3;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        mixBlendMode: 'screen',
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'repeating-linear-gradient(180deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 7px), linear-gradient(90deg, rgba(32,255,202,0.22), transparent 32%, rgba(255,46,72,0.2) 68%, transparent)',
          transform: `translateX(${barShift}%)`,
        }}
      />
      <AbsoluteFill
        style={{
          clipPath: 'polygon(0 14%, 100% 8%, 100% 22%, 0 27%, 0 54%, 100% 48%, 100% 62%, 0 67%)',
          background: 'rgba(255,255,255,0.18)',
          transform: `translateX(${-barShift * 1.6}%)`,
          filter: 'contrast(180%)',
        }}
      />
    </AbsoluteFill>
  );
}

function HistoryArchiveFrameLayer({ frame, fps }: { frame: number; fps: number }) {
  const flicker = frame % Math.max(2, Math.round(fps / 8)) === 0 ? 0.08 : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          boxShadow: 'inset 0 0 0 10px rgba(6, 10, 15, 0.72), inset 0 0 70px rgba(0,0,0,0.64)',
          border: '1px solid rgba(242, 231, 198, 0.18)',
          opacity: 0.62 + flicker,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(2,7,19,0.42), transparent 8%, transparent 92%, rgba(2,7,19,0.42)), repeating-linear-gradient(180deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 5px)',
          mixBlendMode: 'multiply',
          opacity: 0.45,
        }}
      />
    </AbsoluteFill>
  );
}

function SceneLayer({
  clip,
  durationInFrames,
  fps,
  historyVintage,
  trueCrimeDark,
}: {
  clip: AutomatedClip;
  durationInFrames: number;
  fps: number;
  historyVintage: boolean;
  trueCrimeDark: boolean;
}) {
  const frame = useCurrentFrame();
  const progress = Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames - 1)));
  const scale = interpolate(progress, [0, 1], [clip.startScale, clip.endScale]) / 100;
  const historyResetFrames = Math.max(1, Math.round(HISTORY_REFERENCE_RESET_SECONDS * fps));
  const historySegment = historyVintage ? Math.floor(frame / historyResetFrames) : 0;
  const historyResetPhase = historyVintage ? frame % historyResetFrames : historyResetFrames;
  const resetPulse = historyVintage && historySegment > 0 && historyResetPhase < 7
    ? interpolate(historyResetPhase, [0, 7], [1.075, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    : 1;
  const resetX = historyVintage && historySegment > 0 ? (historySegment % 2 === 0 ? 0.55 : -0.55) : 0;
  const resetY = historyVintage && historySegment > 0 ? (historySegment % 3 === 0 ? -0.28 : 0.28) : 0;
  const jumpScale = historyVintage
    ? resetPulse
    : trueCrimeDark && durationInFrames > 3.6 * fps && frame >= 3.4 * fps ? 1.08 : 1;
  const x = interpolate(progress, [0, 1], [clip.startX, clip.endX]);
  const y = interpolate(progress, [0, 1], [clip.startY, clip.endY]);
  const opacity = interpolate(
    frame,
    [0, 10, Math.max(11, durationInFrames - 10), durationInFrames],
    [clip.transition === 'none' ? 1 : 0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const glitchActive = historyVintage && clip.transition === 'glitch' && frame < Math.round(0.42 * fps);
  const glitchX = glitchActive
    ? frame % 5 === 0 ? -1.8 : frame % 5 === 1 ? 2.2 : frame % 5 === 2 ? -0.9 : 0.7
    : 0;
  const glitchY = glitchActive && frame % 3 === 0 ? 0.45 : 0;
  const transitionX = clip.transition === 'slideleft'
    ? interpolate(frame, [0, Math.min(14, durationInFrames)], [8, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    : 0;
  const transitionY = clip.transition === 'slidedown'
    ? interpolate(frame, [0, Math.min(14, durationInFrames)], [-8, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    : 0;

  const mediaStyle = {
    width: '100%',
    height: '100%',
    objectFit: clip.type === 'image' ? 'contain' as const : 'cover' as const,
    transform: `translate(${x + resetX}%, ${y + resetY}%) scale(${scale * jumpScale}) rotate(${clip.rotation}deg)`,
    filter: historyVintage
      ? `brightness(${Math.min(clip.brightness, 94)}%) contrast(${Math.max(clip.contrast, 122)}%) saturate(${Math.min(clip.saturation, 62)}%) sepia(${Math.max(clip.sepia, 38)}%)`
      : trueCrimeDark
        ? `brightness(${Math.min(clip.brightness, 86)}%) contrast(${Math.max(clip.contrast, 128)}%) saturate(${Math.min(clip.saturation, 52)}%) sepia(${Math.min(clip.sepia, 10)}%) hue-rotate(-8deg)`
        : `brightness(${clip.brightness}%) contrast(${clip.contrast}%) saturate(${clip.saturation}%) sepia(${clip.sepia}%)`,
  };

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: '#000',
        transform: `translate(${transitionX + glitchX}%, ${transitionY + glitchY}%)`,
      }}
    >
      {clip.type === 'video' ? (
        <OffthreadVideo
          src={clip.src}
          muted
          startFrom={Math.max(0, Math.round(clip.sourceStart * fps))}
          delayRenderTimeoutInMilliseconds={120000}
          delayRenderRetries={2}
          style={mediaStyle}
        />
      ) : (
        <>
          <Img
            src={clip.poster || clip.src}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scale(1.08)',
              filter: 'blur(18px) brightness(42%) saturate(90%)',
            }}
          />
          <Img src={clip.poster || clip.src} style={{ ...mediaStyle, position: 'absolute', inset: 0 }} />
        </>
      )}
      <AbsoluteFill
        style={{
          background: trueCrimeDark
            ? 'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.04) 38%, rgba(0,0,0,0.68) 100%)'
            : historyVintage
              ? 'linear-gradient(180deg, rgba(0,0,0,0.26) 0%, rgba(0,0,0,0.03) 42%, rgba(0,0,0,0.54) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.02) 45%, rgba(0,0,0,0.44) 100%)',
        }}
      />
      {historyVintage && <HistoryArchiveFrameLayer frame={frame} fps={fps} />}
      {historyVintage && clip.transition === 'screenburn' && <ScreenBurnTransitionLayer frame={frame} fps={fps} />}
      {historyVintage && clip.transition === 'glitch' && <GlitchTransitionLayer frame={frame} fps={fps} />}
    </AbsoluteFill>
  );
}

function isListNumberText(text: string) {
  return /^\s*(?:#?\d+|number\s+\w+)\s*[\).:-]/i.test(text);
}

function TextLayer({ overlay, fps, historyVintage, trueCrimeDark }: { overlay: AutomatedTextOverlay; fps: number; historyVintage: boolean; trueCrimeDark: boolean }) {
  const frame = useCurrentFrame();
  const entrance = interpolate(frame, [0, 9], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const springScale = historyVintage || trueCrimeDark
    ? spring({ frame, fps, config: { stiffness: 400, damping: 10 } })
    : 1;
  const opacity = interpolate(frame, [0, 8, Math.max(9, overlay.duration * fps - 8), overlay.duration * fps], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: `${overlay.x}%`,
        top: `${overlay.y}%`,
        maxWidth: '82%',
        transform: `translate(-50%, calc(-50% + ${entrance}px)) scale(${springScale})`,
        padding: '10px 14px',
        borderRadius: 6,
        color: overlay.color,
        background: trueCrimeDark ? 'rgba(10, 12, 14, 0.86)' : `${overlay.background}c8`,
        border: trueCrimeDark ? '1px solid rgba(168, 30, 44, 0.58)' : undefined,
        fontFamily: (historyVintage || trueCrimeDark) && isListNumberText(overlay.text)
          ? (trueCrimeDark ? '"Courier New", Courier, monospace' : 'Georgia, "Times New Roman", serif')
          : '"Arial Black", Arial, Helvetica, sans-serif',
        fontSize: overlay.size,
        fontWeight: 700,
        lineHeight: 1.15,
        opacity,
        textAlign: 'center',
        textShadow: '0 2px 8px rgba(0,0,0,0.9)',
      }}
    >
      {overlay.text}
    </div>
  );
}

function FilmTextureLayer({ durationInFrames, fps }: { durationInFrames: number; fps: number }) {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Loop durationInFrames={Math.max(1, Math.round(4 * fps))}>
        <OffthreadVideo
          src={staticFile('overlays/vitevid-film-grain-scratches.mp4')}
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.15,
            mixBlendMode: 'screen',
          }}
        />
      </Loop>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at 50% 48%, transparent 46%, rgba(0,0,0,0.34) 100%)',
          opacity: 0.55,
        }}
      />
    </AbsoluteFill>
  );
}

function TrueCrimeTextureLayer() {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 50% 44%, transparent 32%, rgba(0,0,0,0.74) 100%), linear-gradient(90deg, rgba(5,22,24,0.28), transparent 34%, rgba(52,4,11,0.22))',
          mixBlendMode: 'multiply',
          opacity: 0.82,
        }}
      />
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.035), transparent 18%, transparent 82%, rgba(0,0,0,0.2))',
          opacity: 0.5,
        }}
      />
    </AbsoluteFill>
  );
}

export function AutomatedVideo(props: AutomatedVideoProps) {
  const starts = sceneStartFrames(props.clips, props.fps);
  const { durationInFrames } = useVideoConfig();
  const historyVintage = props.stylePreset === 'history-vintage';
  const trueCrimeDark = props.stylePreset === 'true-crime-dark';
  const musicTracks = props.musicTracks?.length
    ? props.musicTracks
    : props.musicTrack ? [props.musicTrack] : [];

  return (
    <AbsoluteFill style={{ backgroundColor: props.canvasColor }}>
      {props.clips.map((clip, index) => {
        const durationInFrames = Math.max(1, Math.round(clip.duration * props.fps));
        return (
          <Sequence key={clip.id} from={starts[index]} durationInFrames={durationInFrames}>
            <SceneLayer clip={clip} durationInFrames={durationInFrames} fps={props.fps} historyVintage={historyVintage} trueCrimeDark={trueCrimeDark} />
          </Sequence>
        );
      })}
      {props.textOverlays.map((overlay) => (
        <Sequence
          key={overlay.id}
          from={Math.round(overlay.start * props.fps)}
          durationInFrames={Math.max(1, Math.round(overlay.duration * props.fps))}
        >
          <TextLayer overlay={overlay} fps={props.fps} historyVintage={historyVintage} trueCrimeDark={trueCrimeDark} />
        </Sequence>
      ))}
      {historyVintage && <FilmTextureLayer durationInFrames={durationInFrames} fps={props.fps} />}
      {trueCrimeDark && <TrueCrimeTextureLayer />}
      {musicTracks.map((musicTrack, index) => musicTrack.duration > 0 && (
        <Sequence
          key={`${musicTrack.src}-${index}`}
          from={Math.max(0, Math.round(musicTrack.start * props.fps))}
          durationInFrames={Math.max(1, Math.round(musicTrack.duration * props.fps))}
        >
          {musicTrack.loop ? (
            <Loop durationInFrames={Math.max(1, Math.round((musicTrack.sourceDuration || musicTrack.duration) * props.fps))}>
              <Audio
                src={musicTrack.src}
                startFrom={Math.max(0, Math.round(musicTrack.sourceStart * props.fps))}
                volume={musicTrack.volume}
              />
            </Loop>
          ) : (
            <Audio
              src={musicTrack.src}
              startFrom={Math.max(0, Math.round(musicTrack.sourceStart * props.fps))}
              volume={musicTrack.volume}
            />
          )}
        </Sequence>
      ))}
      {props.audioTrack && props.audioTrack.duration > 0 && (
        <Sequence
          from={Math.max(0, Math.round(props.audioTrack.start * props.fps))}
          durationInFrames={Math.max(1, Math.round(props.audioTrack.duration * props.fps))}
        >
          <Audio
            src={props.audioTrack.src}
            startFrom={Math.max(0, Math.round(props.audioTrack.sourceStart * props.fps))}
            volume={props.audioTrack.volume}
          />
        </Sequence>
      )}
      {(props.soundEffects || []).map((effect, index) => (
        <Sequence
          key={`${effect.src}-${index}`}
          from={Math.max(0, Math.round(effect.start * props.fps))}
          durationInFrames={Math.max(1, Math.round(effect.duration * props.fps))}
        >
          <Audio
            src={effect.src}
            startFrom={Math.max(0, Math.round(effect.sourceStart * props.fps))}
            volume={effect.volume}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
