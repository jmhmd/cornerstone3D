interface ProgressiveLoadOptions {
  // rangeType only 'bytes' for now, it seems the spec leaves this open to other
  // possibilities though?
  rangeType: 'bytes';
  // Array of ranges to fetch in order of least resolution to most, i.e.
  // [[0,100_000], [100_001, 200_000], [200_001, Infinity]]
  // To fetch the remainder of the file, either set the end byte to `Infinity`
  // or leave it out.
  ranges: [number, number?][];
  // Automatically trigger the next byte range to load for all images in the
  // stack/volume once the prior range is finished loading.
  autoLoadAllRanges?: boolean;
}

export default ProgressiveLoadOptions;
