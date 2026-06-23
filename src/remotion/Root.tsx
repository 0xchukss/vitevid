import { type ComponentType } from 'react';
import { Composition } from 'remotion';
import { AutomatedVideo } from './AutomatedVideo';
import { AutomatedVideoProps } from './automated-edit';

const defaultProps: AutomatedVideoProps = {
  clips: [],
  textOverlays: [],
  canvasColor: '#000000',
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 1,
};

export function RemotionRoot() {
  return (
    <Composition
      id="AutomatedVideo"
      component={AutomatedVideo as unknown as ComponentType<Record<string, unknown>>}
      durationInFrames={defaultProps.durationInFrames}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const typedProps = props as unknown as AutomatedVideoProps;
        return {
          durationInFrames: typedProps.durationInFrames,
          fps: typedProps.fps,
          width: typedProps.width,
          height: typedProps.height,
          props,
        };
      }}
    />
  );
}
