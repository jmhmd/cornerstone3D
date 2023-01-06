import {
  RenderingEngine,
  Types,
  Enums,
  cache,
  setVolumesForViewports,
  volumeLoader,
  CONSTANTS,
} from '@cornerstonejs/core';
import {
  initDemo,
  createImageIdsAndCacheMetaData,
  setTitleAndDescription,
} from '../../../../utils/demo/helpers';
import * as cornerstoneTools from '@cornerstonejs/tools';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPolyLine from '@kitware/vtk.js/Common/DataModel/Polyline';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';

import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/Profiles/Volume';

window.cache = cache;

// This is for debugging purposes
console.warn(
  'Click on index.ts to open source code for this example --------->'
);

const {
  LengthTool,
  ToolGroupManager,
  StackScrollMouseWheelTool,
  ZoomTool,
  TrackballRotateTool,
  Enums: csToolsEnums,
} = cornerstoneTools;

const { ViewportType } = Enums;
const { MouseBindings } = csToolsEnums;

// Define a unique id for the volume
const volumeName = 'CT_VOLUME_ID'; // Id of the volume less loader prefix
const volumeLoaderScheme = 'cornerstoneStreamingImageVolume'; // Loader id which defines which volume loader to use
const volumeId = `${volumeLoaderScheme}:${volumeName}`; // VolumeId with loader id + volume id

// ======== Set up page ======== //
setTitleAndDescription(
  'Annotation Tools On Volumes',
  'Here we demonstrate how annotation tools can be drawn/rendered on any plane.'
);

const size = '500px';
const content = document.getElementById('content');
const viewportGrid = document.createElement('div');

viewportGrid.style.display = 'flex';
viewportGrid.style.display = 'flex';
viewportGrid.style.flexDirection = 'row';

const element1 = document.createElement('div');
const element2 = document.createElement('div');
const element3 = document.createElement('div');
element1.oncontextmenu = () => false;
element2.oncontextmenu = () => false;
element3.oncontextmenu = () => false;

element1.style.width = size;
element1.style.height = size;
element2.style.width = size;
element2.style.height = size;
element3.style.width = size;
element3.style.height = size;

viewportGrid.appendChild(element1);
viewportGrid.appendChild(element2);
viewportGrid.appendChild(element3);

content.appendChild(viewportGrid);

const instructions = document.createElement('p');
instructions.innerText =
  'Left Click to draw length measurements on any viewport.\n Use the mouse wheel to scroll through the stack.';

content.append(instructions);
// ============================= //

/**
 * Runs the demo
 */
async function run() {
  // Init Cornerstone and related libraries
  await initDemo();

  const toolGroupId = 'STACK_TOOL_GROUP_ID';

  // Add tools to Cornerstone3D
  cornerstoneTools.addTool(LengthTool);
  cornerstoneTools.addTool(TrackballRotateTool);
  cornerstoneTools.addTool(ZoomTool);
  cornerstoneTools.addTool(StackScrollMouseWheelTool);

  // Define a tool group, which defines how mouse events map to tool commands for
  // Any viewport using the group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Add the tools to the tool group and specify which volume they are pointing at
  toolGroup.addTool(LengthTool.toolName, { volumeId });
  toolGroup.addTool(TrackballRotateTool.toolName);
  toolGroup.addTool(ZoomTool.toolName, { volumeId });
  toolGroup.addTool(StackScrollMouseWheelTool.toolName);

  // Set the initial state of the tools, here we set one tool active on left click.
  // This means left click will draw that tool.
  toolGroup.setToolActive(TrackballRotateTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Primary, // Left Click
      },
    ],
  });

  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Secondary, // Right Click
      },
    ],
  });

  // As the Stack Scroll mouse wheel is a tool using the `mouseWheelCallback`
  // hook instead of mouse buttons, it does not need to assign any mouse button.
  toolGroup.setToolActive(StackScrollMouseWheelTool.toolName);

  // Get Cornerstone imageIds and fetch metadata into RAM
  const imageIds = await createImageIdsAndCacheMetaData({
    StudyInstanceUID:
      '1.3.6.1.4.1.14519.5.2.1.7009.2403.334240657131972136850343327463',
    SeriesInstanceUID:
      '1.3.6.1.4.1.14519.5.2.1.7009.2403.226151125820845824875394858561',
    wadoRsRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
    type: 'VOLUME',
  });

  // Instantiate a rendering engine
  const renderingEngineId = 'myRenderingEngine';
  const renderingEngine = new RenderingEngine(renderingEngineId);

  // Create the viewports
  const viewportIds = [
    'CT_AXIAL_STACK',
    'CT_SAGITTAL_STACK',
    'CT_OBLIQUE_STACK',
  ];

  const viewportInputArray = [
    {
      viewportId: viewportIds[0],
      type: ViewportType.ORTHOGRAPHIC,
      element: element1,
      defaultOptions: {
        orientation: Enums.OrientationAxis.AXIAL,
        background: <Types.Point3>[0.2, 0, 0.2],
      },
    },
    {
      viewportId: viewportIds[1],
      type: ViewportType.ORTHOGRAPHIC,
      element: element2,
      defaultOptions: {
        orientation: Enums.OrientationAxis.SAGITTAL,
        background: <Types.Point3>[0.2, 0, 0.2],
      },
    },
    {
      viewportId: viewportIds[2],
      type: ViewportType.ORTHOGRAPHIC,
      element: element3,
      defaultOptions: {
        orientation: {
          // Random oblique orientation
          viewUp: <Types.Point3>[
            -0.5962687530844388, 0.5453181550345819, -0.5891448751239446,
          ],
          viewPlaneNormal: <Types.Point3>[
            -0.5962687530844388, 0.5453181550345819, -0.5891448751239446,
          ],
        },
        background: <Types.Point3>[0.2, 0, 0.2],
      },
    },
  ];

  renderingEngine.setViewports(viewportInputArray);

  // Set the tool group on the viewports
  viewportIds.forEach((viewportId) =>
    toolGroup.addViewport(viewportId, renderingEngineId)
  );

  // Define a volume in memory
  const volume = await volumeLoader.createAndCacheVolume(volumeId, {
    imageIds,
  });

  // Set the volume to load
  volume.load();
  const viewportId = viewportIds[0];
  const viewport = renderingEngine.getViewport(viewportIds[0]);

  setVolumesForViewports(
    renderingEngine,
    [{ volumeId }],
    [viewportIds[0]]
  ).then(() => {
    // const filterActorUIDs = viewport.getActors().map((actor) => actor.uid);
    // viewport.setBlendMode(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND);
    // viewport.setSlabThickness(5);

    const volumeActor = renderingEngine
      .getViewport(viewportId)
      .getDefaultActor().actor;

    // utilities.applyPreset(
    //   volumeActor,
    //   CONSTANTS.VIEWPORT_PRESETS.find((preset) => preset.name === 'CT-AAA')
    // );

    viewport.render();
  });

  // Render the image
  renderingEngine.renderViewports(viewportIds);

  setTimeout(() => {
    addPolyData(viewport);
    // addSphere(viewport);
  }, 1000);
}

function addSphere(viewport) {
  const { actor: sphereActor, mapper: sphereMapper } = getSphereActor({
    center: [0, 0, -144],
    radius: 50,
    phiResolution: 30,
    thetaResolution: 30,
    opacity: 1,
    edgeVisibility: true,
  });

  sphereActor.setMapper(sphereMapper);
  viewport.addActor({ actor: sphereActor, uid: 'sphere' });

  viewport.resetCamera();
  viewport.render();
}

function addPolyData(viewport) {
  const z = -140.0899965;
  // z = 78.0;
  const pointList = [
    [-58.8541378715953, -80.2549051, z],
    [7.293688182879407, -89.9825266, z],
    [38.42207691439694, -38.42613276653691, z],
    [-21.8891762, -1.461171147859858, z],
    [-63.71794861089492, -36.48060847081706, z],
  ];

  const pointList1 = [
    [1, -204, -141.0899965],
    [66, -207, -141.0899965],
    [89, -179, -141.0899965],
    [8, -171, -141.0899965],
    [-92, -186, -141.0899965],
  ];

  const points = vtkPoints.newInstance();
  points.setData(Float32Array.from(pointList.flat()), 3);

  const lines = vtkCellArray.newInstance();
  lines.setData(Uint32Array.from([5, 0, 1, 2, 3, 4]), 3);

  const polygon = vtkPolyData.newInstance();
  polygon.setPoints(points);
  polygon.setLines(lines);

  const mapper1 = vtkMapper.newInstance();
  mapper1.setInputData(polygon);

  const actor1 = vtkActor.newInstance();
  actor1.setMapper(mapper1);
  actor1.getProperty().setLineWidth(10);
  actor1.getProperty().setColor(0, 0.5, 0);

  viewport.addActor({ actor: actor1, uid: 'polyData' });

  viewport.resetCamera();
  viewport.render();
  // viewport.getVtkActiveCamera().elevation(-195);
  // viewport.getVtkActiveCamera().roll(40);
  // viewport.getVtkActiveCamera().yaw(20);

  // const renderer = viewport.getRenderer();
  // renderer.addActor(actor1);

  window.viewport = viewport;
}

function getSphereActor({
  center,
  radius,
  phiResolution,
  thetaResolution,
  opacity,
  edgeVisibility,
}) {
  const sphereSource = vtkSphereSource.newInstance({
    center,
    radius,
    phiResolution,
    thetaResolution,
  });

  const actor = vtkActor.newInstance();
  const mapper = vtkMapper.newInstance();

  actor.getProperty().setEdgeVisibility(edgeVisibility);
  actor.getProperty().setOpacity(opacity);

  mapper.setInputConnection(sphereSource.getOutputPort());
  actor.setMapper(mapper);
  // actor.setForceTranslucent(true);

  const polyData = sphereSource.getOutputData();
  const data = polyData.getPoints().getData();

  return { actor, data, mapper };
}

run();
