import { FrameStatus } from '../enums';

interface IStreamingVolumeProperties {
  /** imageIds of the volume  */
  imageIds: Array<string>;

  /** loading status object for the volume containing loaded/loading statuses */
  loadStatus: {
    loaded: boolean;
    loading: boolean;
    cancelled: boolean;
    cachedFrames: Array<FrameStatus>;
    callbacks: Array<() => void>;
  };
}

export default IStreamingVolumeProperties;
