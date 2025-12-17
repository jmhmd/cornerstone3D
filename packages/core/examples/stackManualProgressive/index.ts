import {
  Enums,
  cache,
  ProgressiveRetrieveImages,
  utilities,
  RenderingEngine,
  metaData,
  loadNextImageLoadStage,
  eventTarget,
  type Types,
} from '@cornerstonejs/core';
import {
  initDemo,
  createImageIdsAndCacheMetaData,
  setTitleAndDescription,
  getLocalUrl,
} from '../../../../utils/demo/helpers';

const { imageRetrieveMetadataProvider } = utilities;
const { sequentialRetrieveStages } = ProgressiveRetrieveImages;
const { Events } = Enums;

console.warn(
  'Click on index.ts to open source code for this example --------->'
);

const { ViewportType, ImageQualityStatus } = Enums;

// ======== Set up page ======== //
setTitleAndDescription(
  'Manual Progressive Loading',
  'Demonstrates manual stage triggering in progressive image loading'
);

const content = document.getElementById('content');

const instructions = document.createElement('p');
instructions.innerHTML = `
  <strong>Manual Progressive Loading Demo</strong><br/>
  This example shows how to use manual stage triggers to control progressive loading.<br/>
  Click a configuration to load, then use the "Load Next Stage" button to manually advance.
`;
content.appendChild(instructions);

const loaders = document.createElement('div');
loaders.style.marginBottom = '1em';
content.appendChild(loaders);

const manualControlsDiv = document.createElement('div');
manualControlsDiv.style.marginBottom = '1em';
manualControlsDiv.style.padding = '10px';
manualControlsDiv.style.backgroundColor = '#f0f0f0';
manualControlsDiv.style.border = '1px solid #ccc';
content.appendChild(manualControlsDiv);

const stageStatus = document.createElement('div');
stageStatus.style.marginBottom = '1em';
stageStatus.style.padding = '10px';
stageStatus.style.backgroundColor = '#e8f4f8';
stageStatus.style.border = '1px solid #b3d9e6';
stageStatus.innerHTML = '<strong>Stage Status:</strong> No image loaded';
content.appendChild(stageStatus);

const timingInfo = document.createElement('div');
timingInfo.style.width = '45em';
timingInfo.style.height = '12em';
timingInfo.style.float = 'left';
timingInfo.style.overflow = 'auto';
timingInfo.innerText = 'Timing Info Here';
content.appendChild(timingInfo);

const configInfo = document.createElement('div');
configInfo.style.width = '35em';
configInfo.style.height = '12em';
configInfo.style.float = 'left';
configInfo.style.overflow = 'auto';
content.appendChild(configInfo);
configInfo.innerHTML = `
<p style="font-size: 0.9em;">
<strong>HTJ2K Byte Range Progressive Loading</strong><br/>
This example demonstrates manual stage triggering with HTJ2K byte-range progressive loading.<br/>
<br/>
<strong>Stages:</strong>
<ul style="margin-top: 0.5em;">
<li><strong>htj2kInitial</strong> (auto) - Loads first byte range (128KB, decodeLevel 2)</li>
<li><strong>htj2kMiddle</strong> (manual) - Loads rangeIndex 5 with decodeLevel 1</li>
<li><strong>htj2kFull</strong> (manual) - Loads full resolution (rangeIndex -1)</li>
</ul>
</p>
`;

const element = document.createElement('div');
element.id = 'cornerstone-element';
const devicePixelRatio = window.devicePixelRatio || 1;
element.style.width = `${3036 / devicePixelRatio}px`;
element.style.height = `${3036 / devicePixelRatio}px`;
element.style.clear = 'both';
content.appendChild(element);

// ============================= //

const statusNames = {
  [ImageQualityStatus.FULL_RESOLUTION]: 'Full Resolution',
  [ImageQualityStatus.LOSSY]: 'Lossy',
  [ImageQualityStatus.SUBRESOLUTION]: 'Sub-Resolution',
};

let startTime = Date.now();
let currentImageId: string | null = null;
let currentConfig: any = null;
let loadNextStageButton: HTMLButtonElement | null = null;

// Listen to stage completion events
eventTarget.addEventListener(Events.IMAGE_RETRIEVAL_STAGE, (evt: any) => {
  const { stageId, numberOfImages, successfulImages } = evt.detail;
  const stageName = stageId || 'unknown';
  console.log(`Stage '${stageName}' completed:`, {
    numberOfImages,
    successfulImages,
  });

  const totalTime = Date.now() - startTime;
  stageStatus.innerHTML = `
    <strong>Stage Status:</strong> Stage '${stageName}' completed<br/>
    <span style="font-size: 0.9em;">
      Images: ${successfulImages}/${numberOfImages} |
      Time: ${totalTime}ms
    </span>
  `;

  // Check if we can advance to the next stage
  if (currentImageId && loadNextStageButton) {
    loadNextStageButton.disabled = false;
    loadNextStageButton.style.backgroundColor = '#4CAF50';
  }
});

async function newImageFunction(evt) {
  const { image } = evt.detail;
  const {
    imageQualityStatus: status,
    decodeTimeInMS,
    loadTimeInMS,
    transferSyntaxUID,
  } = image;
  const complete = status === ImageQualityStatus.FULL_RESOLUTION;

  const completeText = statusNames[status] || `Status ${status}`;
  const totalTime = Date.now() - startTime;
  const timestamp = new Date().toLocaleTimeString();

  timingInfo.innerHTML += `<p style="margin:0; font-size: 0.9em;">[${timestamp}] Rendered <strong>${completeText}</strong> | Load: ${loadTimeInMS}ms | Decode: ${decodeTimeInMS}ms | Total: ${totalTime}ms</p>`;

  // Auto-scroll to bottom
  timingInfo.scrollTop = timingInfo.scrollHeight;

  if (complete) {
    element.removeEventListener(Events.STACK_NEW_IMAGE, newImageFunction);
    stageStatus.innerHTML = `
      <strong>Stage Status:</strong> <span style="color: green;">Complete - Full Resolution Loaded</span>
    `;
  }
}

async function showStack(
  stack: string[],
  viewport,
  retrieveConfiguration,
  name: string
) {
  cache.purgeCache();
  imageRetrieveMetadataProvider.clear();

  currentImageId = stack[0];
  currentConfig = retrieveConfiguration;

  if (retrieveConfiguration) {
    imageRetrieveMetadataProvider.add('stack', retrieveConfiguration);
  }

  timingInfo.innerHTML = `<p style="margin:0; font-weight: bold;">Loading ${name}...</p>`;
  stageStatus.innerHTML = `<strong>Stage Status:</strong> Loading started for '${name}'`;

  startTime = Date.now();
  element.addEventListener(Events.STACK_NEW_IMAGE, newImageFunction);

  // Enable the manual control button if we have a manual stage
  if (loadNextStageButton) {
    loadNextStageButton.disabled = true;
    loadNextStageButton.style.backgroundColor = '#ccc';
  }

  const start = Date.now();
  await viewport.setStack(stack, 0, retrieveConfiguration);
  viewport.render();

  const end = Date.now();
  const { transferSyntaxUID } = metaData.get('transferSyntax', stack[0]);
  timingInfo.innerHTML += `<p style="margin:0;">Initial render took ${
    end - start
  }ms using ${transferSyntaxUID}</p>`;
}

// ============================= //
// Configuration
// ============================= //

/**
 * HTJ2K byte-range with manual triggers
 * Uses byte-range progressive loading with manual advancement
 *
 * This configuration demonstrates:
 * - Auto stage: htj2kInitial loads first byte range automatically
 * - Manual stage 1: htj2kMiddle requires manual trigger
 * - Manual stage 2: htj2kFull requires manual trigger
 */
const htj2kManualConfig = {
  stages: [
    {
      id: 'htj2kInitial',
      retrieveType: 'singleFast',
    },
    {
      id: 'htj2kMiddle',
      retrieveType: 'singleMiddle',
      manual: true, // Manual trigger for middle quality
    },
    {
      id: 'htj2kFull',
      retrieveType: 'singleFinal',
      manual: true, // Manual trigger for full resolution
    },
  ],
  retrieveOptions: {
    singleFast: {
      // imageQualityStatus: ImageQualityStatus.LOSSY,
      decodeLevel: 2,
      chunkSize: 128 * 1024,
      rangeIndex: 0,
    },
    singleMiddle: {
      // imageQualityStatus: ImageQualityStatus.LOSSY,
      decodeLevel: 1,
      rangeIndex: 5,
    },
    singleFinal: {
      // imageQualityStatus: ImageQualityStatus.FULL_RESOLUTION,
      rangeIndex: -1,
    },
  },
};

/**
 * Runs the demo
 */
async function run() {
  await initDemo();

  const imageIds = await createImageIdsAndCacheMetaData({
    StudyInstanceUID:
      '1.2.276.0.45.1.7.2.268294861383744.23051809061200008.66238',
    SeriesInstanceUID:
      '1.2.276.0.45.1.7.3.268294861383744.23051809061700087.66238',
    wadoRsRoot:
      getLocalUrl() ||
      'https://litevna.app/key_eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..CjXYVVO_sLz6jeuj.AwqGiS3LZF3Os43FceZBHjiGYTJkBwWBUTMqLuSZdde28PyJvqbdUvit7sUOftMtEkLhlB9NqBFi2NQzH-RzuR2OVTLNbojzxVVy6shJzbUfZUnkafyugQq50fpYXBeCCB9UzPvfm02KX913YIaVYKaJPu2GlwqUpUJgj9vcihzM_KB1_tV9HM9GN34DaiDkNFJvNFt8E9GHd1K0x7Je8OoPbmzF5H9aMB2FvPAd7XgujPhrRJQVSk8N3jGRbtNV_FXSrLpy-7EbP2rc0DP1piYw4gGeqlmv9uSmtnuQZY008uP6r5vnS34VHg0iNkCmz35T4jx00PsNsU7BWGO0Lpt8e4sPbSwen9H6K-HCi5a2SdoJSU4xttJjDNO2kpYyOmcjUPXG_GsVuIZ0e7fqBvky8CszR4S8iQvanINmoeN1nabXnwxFOoMfNYS-8rNlpZ3Ere5f3EbL-e86jUEkuM5lKxCeFbipk9rM-6dVFNiNYwHyriKB-NaQWj5F3LzJ_sjh2MWTZU7hAgbGwPqz9DqUY-RjcM5BiJ-VbRKK7-5gXS8igiSHRHPjK7DT-ykE0QBY_AYpSm7LIHMH2meH3VIa81YVpPFLViP_l3-s8V8MqlVJpQLKsjAy6zQrWMFRQWye71eNs3H3WC1RRMMQDTyH5J_eszR_xdDnYNwlDE412XFbXlFtv2wS2D7KZa_AioKkqUyndTA14bHPNaL5dx1Kx8QizGCD58NVUn94GhjMvk9M4OShlRKmMVzKmJ9ms1efNjR_UaJlET0HYBgMUMyBp-WvzGUl2VOk0FsiJ4W5hwnBqWja9flva8XgSiUEUmEjzh4lQhXJCwd4WFdamwRybvh81oF4kSOqDO9eyX4jE5eSkkQjEi03ahxIa5wYpFsNEtMyuN0XGNYflQ.DhOE-Bd7njfwWfpbc4jlrQ/dicomweb',
  });

  const renderingEngineId = 'myRenderingEngine';
  const renderingEngine = new RenderingEngine(renderingEngineId);

  const viewportId = 'stackViewport';
  const viewportInput = {
    viewportId,
    type: ViewportType.STACK,
    element,
    defaultOptions: {
      background: [0.2, 0, 0.2] as Types.Point3,
    },
  };

  renderingEngine.enableElement(viewportInput);

  const viewport = renderingEngine.getViewport(
    viewportId
  ) as Types.IStackViewport;

  const createButton = (text, action) => {
    const button = document.createElement('button');
    button.innerText = text;
    button.id = text;
    button.onclick = action;
    button.style.marginRight = '5px';
    button.style.padding = '8px 12px';
    loaders.appendChild(button);
    return button;
  };

  const loadButton = (text, imageIds, retrieveConfiguration) => {
    return createButton(
      text,
      showStack.bind(null, imageIds, viewport, retrieveConfiguration, text)
    );
  };

  // Create load button
  loadButton('Load HTJ2K Progressive', imageIds, htj2kManualConfig);

  // Create manual control section
  manualControlsDiv.innerHTML = '<strong>Manual Controls:</strong><br/>';

  loadNextStageButton = document.createElement('button');
  loadNextStageButton.innerText = 'Load Next Stage';
  loadNextStageButton.disabled = true;
  loadNextStageButton.style.padding = '10px 20px';
  loadNextStageButton.style.fontSize = '1.1em';
  loadNextStageButton.style.marginTop = '10px';
  loadNextStageButton.style.backgroundColor = '#ccc';
  loadNextStageButton.style.cursor = 'pointer';

  loadNextStageButton.onclick = () => {
    if (currentImageId) {
      const success = loadNextImageLoadStage(currentImageId);
      if (success) {
        console.log('Triggered next manual stage for:', currentImageId);
        stageStatus.innerHTML = `<strong>Stage Status:</strong> <span style="color: blue;">Loading next stage...</span>`;
        loadNextStageButton.disabled = true;
        loadNextStageButton.style.backgroundColor = '#ccc';
      } else {
        console.log('No pending manual stage found');
        stageStatus.innerHTML = `<strong>Stage Status:</strong> <span style="color: orange;">No pending manual stage</span>`;
      }
    }
  };

  manualControlsDiv.appendChild(loadNextStageButton);

  const infoText = document.createElement('p');
  infoText.style.fontSize = '0.9em';
  infoText.style.marginTop = '10px';
  infoText.innerHTML = `
    This button becomes enabled when a manual stage is ready to be triggered.<br/>
    Watch the Stage Status area for completion messages.
  `;
  manualControlsDiv.appendChild(infoText);
}

run();
