import ProgressiveLoadOptions from './ProgressiveLoadOptions';

interface IStreamingVolumeProperties {
  /** imageIds of the volume  */
  imageIds: Array<string>;

  /** loading status object for the volume containing loaded/loading statuses */
  loadStatus: {
    loaded: boolean;
    loading: boolean;
    partial: boolean;
    cancelled: boolean;
    cachedFrames: Array<boolean>;
    callbacks: Array<() => void>;
  };

  progressive?: ProgressiveLoadOptions;
}

export default IStreamingVolumeProperties;
