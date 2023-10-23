import { Types, utilities } from '@cornerstonejs/core';

import { xhrRequest } from '../internal/index';
// import rangeRequest from '../internal/rangeRequest';
import streamRequest from '../internal/streamRequest';
import rangeRequest from '../internal/rangeRequest';
import extractMultipart from './extractMultipart';
import { getFrameStatus } from './getFrameStatus';

const { ProgressiveIterator } = utilities;

function getPixelData(
  uri: string,
  imageId: string,
  mediaType = 'application/octet-stream',
  options?: CornerstoneWadoRsLoaderOptions
) {
  const { streamingData, retrieveOptions = {} } = options || {};
  const headers = {
    Accept: mediaType,
  };

  // Add urlArguments to the url for retrieving - allows accept and other
  // parameters to be added.
  let url = retrieveOptions.urlArguments
    ? `${uri}${uri.indexOf('?') === -1 ? '?' : '&'}${
        retrieveOptions.urlArguments
      }`
    : uri;

  // Replace the /frames/ part of the path with another path to choose
  // a different resource type.
  if (retrieveOptions.framesPath) {
    url = url.replace('/frames/', retrieveOptions.framesPath);
  }

  // Swap the streaming data out if a new instance starts.
  if (streamingData?.url !== url) {
    options.streamingData = { url };
  }

  if (retrieveOptions.initialBytes || retrieveOptions.range !== undefined) {
    return rangeRequest(url, imageId, headers, options);
  }

  // Default to streaming the response data so that it can be decoding in
  // a streaming parser.
  if (retrieveOptions.streaming !== false) {
    return streamRequest(url, imageId, headers, options);
  }

  /**
   * Not progressively rendering, use regular xhr request.
   */
  const loadIterator = new ProgressiveIterator('xhrRequestImage');
  const loadPromise = xhrRequest(url, imageId, headers);
  const { xhr } = loadPromise;

  loadPromise.then(
    function (imageFrameAsArrayBuffer /* , xhr*/) {
      const contentType =
        xhr.getResponseHeader('Content-Type') || 'application/octet-stream';
      const extracted = extractMultipart(
        contentType,
        new Uint8Array(imageFrameAsArrayBuffer)
      );
      extracted.status = getFrameStatus(retrieveOptions, true);
      loadIterator.add(extracted, true);
    },
    (reason) => loadIterator.reject(reason)
  );
  return loadIterator.getNextPromise();
}

export default getPixelData;
