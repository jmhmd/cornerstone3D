import { RenderingEngine, Types, Enums, cache } from '@cornerstonejs/core';
import {
  initDemo,
  createImageIdsAndCacheMetaData,
  setTitleAndDescription,
} from '../../../../utils/demo/helpers';

import cornerstoneDicomImageLoader from '@cornerstonejs/dicom-image-loader';

// This is for debugging purposes
console.warn(
  'Click on index.ts to open source code for this example --------->'
);

const { ViewportType, ImageStatus } = Enums;

// ======== Set up page ======== //
setTitleAndDescription(
  'Progressive Stack',
  'Displays a single DICOM image in a Stack viewport after clicking the load button.'
);

const content = document.getElementById('content');
const { cornerstone } = window;

const instructions = document.createElement('p');
instructions.innerText = 'Click on a button to perform the given load type';
content.appendChild(instructions);

const loaders = document.createElement('div');
content.appendChild(loaders);

const timingInfo = document.createElement('div');
timingInfo.style.width = '35em';
timingInfo.style.height = '10em';
timingInfo.style.float = 'left';
timingInfo.innerText = 'Timing Info Here';
content.appendChild(timingInfo);

const itemInfo = document.createElement('div');
itemInfo.style.width = '25em';
itemInfo.style.height = '10em';
itemInfo.style.float = 'left';
content.appendChild(itemInfo);
itemInfo.innerHTML = `
<ul>
<li>JLS Thumbnail - small JLS thumbnails only</li>
<li>JLS Mixed - thumbnail first, then full</li>
<li>HTJ2K - streaming load</li>
<li>HTJ2K - lossy byte range then lossy full</li>
<li>Bytes - full resolution 64k bytes, then full final</li>
</ul>
`;

const devicePixelRatio = window.devicePixelRatio || 1;
const element = document.createElement('div');
element.id = 'cornerstone-element';
// Use devicePixelRatio here so that the window size fits all pixels, but not
// larger than that.
element.style.width = `${3036 / devicePixelRatio}px`;
element.style.height = `${3036 / devicePixelRatio}px`;
element.style.clear = 'both';
content.appendChild(element);

// ============================= //

const statusNames = {
  [ImageStatus.DONE]: 'done',
  [ImageStatus.LOSSY]: 'lossy',
  [ImageStatus.PARTIAL]: 'partial',
};
async function newImageFunction(evt) {
  const { image } = evt.detail;
  const { status, decodeTimeInMS, loadTimeInMS } = image;
  const complete = status === ImageStatus.DONE;
  if (complete) {
    element.removeEventListener(
      cornerstone.EVENTS.STACK_NEW_IMAGE,
      newImageFunction
    );
  }
  const completeText = statusNames[status] || `other ${status}`;
  timingInfo.innerHTML += `<p style="margin:0">Render ${completeText} took ${loadTimeInMS} ms to load and ${decodeTimeInMS} to decode ${
    loadTimeInMS + decodeTimeInMS
  } total</p>`;
}

async function showStack(stack: string[], viewport, config, name: string) {
  cornerstoneDicomImageLoader.configure(config);
  cache.purgeCache();
  console.time('imageLoad');
  timingInfo.innerHTML = `<p id="loading" style="margin:0">Loading ${name}</p>`;
  element.addEventListener(
    cornerstone.EVENTS.STACK_NEW_IMAGE,
    newImageFunction
  );
  const start = Date.now();
  // Set the stack on the viewport
  await viewport.setStack(stack);

  // Render the image
  viewport.render();
  console.timeEnd('imageLoad');
  const end = Date.now();
  const { transferSyntaxUID } = cornerstone.metaData.get(
    'transferSyntax',
    stack[0]
  );
  document.getElementById('loading').innerText = `Stack render took ${
    end - start
  } using ${transferSyntaxUID}`;
}

/**
 * Generate the various configurations by using the options on static DICOMweb:
 * Base lossy/full thumbnail configuration for HTJ2K:
 * ```
 * mkdicomweb create -t jhc --recompress true --alternate jhc --alternate-name lossy "/dicom/DE Images for Rad"
 * ```
 *
 * JLS and JLS thumbnails:
 * ```bash
 * mkdicomweb create -t jhc --recompress true --alternate jls --alternate-name jls "/dicom/DE Images for Rad"
 * mkdicomweb create -t jhc --recompress true --alternate jls --alternate-name jlsThumbnail --alternate-thumbnail "/dicom/DE Images for Rad"
 * ```
 *
 * HTJ2K and HTJ2K thumbnail - lossless:
 * ```bash
 * mkdicomweb create -t jhc --recompress true --alternate jhcLossless --alternate-name htj2k "/dicom/DE Images for Rad"
 * mkdicomweb create -t jhc --recompress true --alternate jhc --alternate-name htj2kThumbnail --alternate-thumbnail "/dicom/DE Images for Rad"
 * ```
 */
const configJLS = {
  minChunkSize: 65_536,

  retrieveOptions: {
    '3.2.840.10008.1.2.4.96': {
      streaming: true,
    },
    'default-lossy': {
      framesPath: '/jls/',
      // Don't even stream the data, use the original fetch
      streaming: false,
    },
    default: {
      framesPath: '/jls/',
    },
  },
};

const configJLSMixed = {
  retrieveOptions: {
    'default-lossy': {
      isLossy: true,
      framesPath: '/jlsThumbnail/',
    },
    default: {
      framesPath: '/jls/',
    },
  },
};

const configJLSThumbnail = {
  retrieveOptions: {
    '3.2.840.10008.1.2.4.96': {
      streaming: true,
    },
    'default-lossy': {
      // isLossy: true,
      framesPath: '/jlsThumbnail/',
    },
    'default-final': {
      // isLossy: true,
      framesPath: '/jlsThumbnail/',
    },
  },
};

const configHtj2k = {
  retrieveOptions: {
    '3.2.840.10008.1.2.4.96': {
      framesPath: '/htj2k/',
      streaming: true,
    },
    '3.2.840.10008.1.2.4.96-lossy': {
      streaming: true,
      framesPath: '/htj2k',
    },
    'default-lossy': {
      framesPath: '/htj2k/',
    },
    'default-final': {
      framesPath: '/htj2k/',
    },
  },
};

const configHtj2kLossy = {
  retrieveOptions: {
    '3.2.840.10008.1.2.4.96': {
      streaming: true,
    },
    'default-lossy': {
      isLossy: true,
      framesPath: '/lossy/',
      range: 0,
      streaming: true,
      decodeLevel: 3,
    },
    default: {
      framesPath: '/lossy/',
      decodeLevel: 0,
      range: 1,
      streaming: false,
    },
  },
};

const configHtj2kMixed = {
  retrieveOptions: {
    '3.2.840.10008.1.2.4.96': {
      streaming: true,
    },
    'default-lossy': {
      isLossy: true,
      streaming: true,
      range: 0,
      initialBytes: 128000,
      framesPath: '/htj2k/',
      decodeLevel: 3,
    },
    'default-final': {
      range: 1,
      framesPath: '/htj2k/',
      streaming: false,
    },
    default: {
      range: 1,
      framesPath: '/htj2k/',
      streaming: false,
    },
  },
};

/**
 * Runs the demo
 */
async function run() {
  // Init Cornerstone and related libraries
  await initDemo();

  // Get Cornerstone imageIds and fetch metadata into RAM
  const imageIds = await createImageIdsAndCacheMetaData({
    StudyInstanceUID:
      '1.3.6.1.4.1.9590.100.1.2.19841440611855834937505752510708699165',
    SeriesInstanceUID:
      '1.3.6.1.4.1.9590.100.1.2.160160590111755920740089886004263812825',
    wadoRsRoot: 'http://localhost:5000/dicomweb',
  });

  const imageIdsCt = await createImageIdsAndCacheMetaData({
    StudyInstanceUID: '1.3.6.1.4.1.25403.345050719074.3824.20170125113417.1',
    SeriesInstanceUID: '1.3.6.1.4.1.25403.345050719074.3824.20170125113545.4',
    wadoRsRoot: 'http://localhost:5000/dicomweb',
  });

  // Instantiate a rendering engine
  const renderingEngineId = 'myRenderingEngine';
  const renderingEngine = new RenderingEngine(renderingEngineId);

  // Create a stack viewport
  const viewportId = 'stackViewport';
  const viewportInput = {
    viewportId,
    type: ViewportType.STACK,
    element,
    defaultOptions: {
      background: <Types.Point3>[0.2, 0, 0.2],
    },
  };

  renderingEngine.enableElement(viewportInput);

  // Get the stack viewport that was created
  const viewport = <Types.IStackViewport>(
    renderingEngine.getViewport(viewportId)
  );

  const createButton = (text, imageIds, config) => {
    const button = document.createElement('button');
    button.innerText = text;
    button.id = text;
    button.onclick = showStack.bind(null, imageIds, viewport, config, text);
    loaders.appendChild(button);
    return button;
  };

  createButton('JLS', imageIds, configJLS);
  createButton('JLS Thumbnail', imageIds, configJLSThumbnail);
  createButton('JLS Mixed', imageIds, configJLSMixed);

  createButton('HTJ2K', imageIds, configHtj2k);
  createButton('HTJ2K Lossy', imageIds, configHtj2kLossy);
  createButton('HTJ2K Bytes', imageIds, configHtj2kMixed);

  createButton('CT JLS Mixed', imageIdsCt, configJLSMixed);
  createButton('CT HTJ2K Bytes', imageIdsCt, configHtj2kMixed);
}

run();
