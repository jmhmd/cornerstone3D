import { vec2, vec3 } from 'gl-matrix';
import {
  getRenderingEngines,
  CONSTANTS,
  utilities as csUtils,
  Enums,
  getEnabledElement,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import { addAnnotation } from '../stateManagement/annotation/annotationState';

import {
  drawLine as drawLineSvg,
  drawHandles as drawHandlesSvg,
} from '../drawingSvg';
import { filterViewportsWithToolEnabled } from '../utilities/viewportFilters';
import triggerAnnotationRenderForViewportIds from '../utilities/triggerAnnotationRenderForViewportIds';
import { state } from '../store';
import {
  PublicToolProps,
  ToolProps,
  SVGDrawingHelper,
  Annotations,
  Annotation,
  InteractionTypes,
  ToolHandle,
  IPoints,
  ITouchPoints,
} from '../types';
import { StyleSpecifier } from '../types/AnnotationStyle';
// import AnnotationDisplayTool from './base/AnnotationDisplayTool';
import { AnnotationTool } from './base';
import * as lineSegment from '../utilities/math/line';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import { InteractionEventType, MouseMoveEventType } from '../types/EventTypes';
import { Events } from '../enums';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';

const { EPSILON } = CONSTANTS;

interface DynamicReferenceLineAnnotation extends Annotation {
  data: {
    handles: {
      points: Types.Point3[];
      activeOperation: 'drag' | 'rotate' | null;
    };
    viewportProjections: {
      [key: string]: {
        lineCoordsCanvas?: [Types.Point2, Types.Point2];
        dragHandlesCanvas?: [Types.Point2, Types.Point2];
        lineCenterCanvas?: Types.Point2;
        lineCenterWorld?: Types.Point3;
        highlighted: boolean;
      };
    };
  };
}

/**
 * @public
 */

class DynamicReferenceLines extends AnnotationTool {
  static toolName;

  public touchDragCallback: any;
  public mouseDragCallback: any;
  _throttledCalculateCachedStats: any;
  editData: {
    renderingEngine: Types.IRenderingEngine;
    sourceViewport: Types.IStackViewport | Types.IVolumeViewport;
    annotation: DynamicReferenceLineAnnotation;
  } | null = {} as any;
  isDrawing: boolean;
  isHandleOutsideImage: boolean;
  interceptedMouseEventsElements: HTMLDivElement[];

  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        sourceViewportId: '',
        showFullDimension: false,
        // blend mode for slabThickness modifications
        slabThicknessBlendMode: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    this.interceptedMouseEventsElements = [];
  }

  addNewAnnotation(
    evt: InteractionEventType,
    interactionType: InteractionTypes
  ): Annotation {
    console.log('addAnnotation not implemented');
    return;
  }

  cancel(element: HTMLDivElement) {
    console.log('cancel not implemented');
    return;
  }

  handleSelectedCallback(
    evt: InteractionEventType,
    annotation: Annotation,
    handle: ToolHandle,
    interactionType: InteractionTypes
  ): void {
    this._activateModify(evt.detail.element);
    evt.preventDefault();
    return;
  }

  toolSelectedCallback(
    evt: InteractionEventType,
    annotation: Annotation,
    interactionType: InteractionTypes
  ): void {
    this._activateModify(evt.detail.element);
    evt.preventDefault();
    return;
  }

  handleInterceptedMouseDown(e: MouseEvent) {
    // Find point on target canvas
    const { pageX, pageY } = e;
    const element = e.currentTarget as HTMLDivElement;
    const boundingRect = element.getBoundingClientRect();
    const canvasX = pageX - boundingRect.left - window.scrollX;
    const canvasY = pageY - boundingRect.top - window.scrollY;
    const isNearHandle = this.getHandleNearImagePoint(
      element,
      this.editData.annotation,
      [canvasX, canvasY],
      6
    );
    const isNearTool = this.isPointNearTool(
      element,
      this.editData.annotation,
      [canvasX, canvasY],
      6
    );
    // console.log('is near handle:', isNearHandle, 'is near tool', isNearTool);
    const event = new CustomEvent('DYNAMIC_REFERENCE_LINES_MOUSE_DOWN', {
      detail: {
        isNearTool: isNearTool ? true : false,
        isNearHandle: isNearHandle ? true : false,
      },
      cancelable: true,
      bubbles: true,
    });

    return element.dispatchEvent(event);
  }

  interceptMouseEventsForElement(element) {
    if (this.interceptedMouseEventsElements.includes(element)) {
      return;
    }
    element.addEventListener(
      'mousedown',
      this.handleInterceptedMouseDown.bind(this)
    );
    // element.addEventListener(
    //   'CORNERSTONE_TOOLS_MOUSE_DOWN',
    //   this.handleInterceptedMouseDown.bind(this)
    // );
    this.interceptedMouseEventsElements.push(element);
  }

  _init = (): void => {
    const renderingEngines = getRenderingEngines();
    const renderingEngine = renderingEngines[0];

    // Todo: handle this case where it is too soon to get the rendering engine
    if (!renderingEngine) {
      return;
    }

    let viewports = renderingEngine.getViewports();
    viewports = filterViewportsWithToolEnabled(viewports, this.getToolName());

    const sourceViewport = renderingEngine.getViewport(
      this.configuration.sourceViewportId
    ) as Types.IVolumeViewport;

    if (!sourceViewport || !sourceViewport.getImageData()) {
      return;
    }

    const { element } = sourceViewport;
    const { viewUp, viewPlaneNormal } = sourceViewport.getCamera();

    const sourceViewportCanvasCornersInWorld =
      csUtils.getViewportImageCornersInWorld(sourceViewport);

    let annotation = this.editData.annotation;
    const FrameOfReferenceUID = sourceViewport.getFrameOfReferenceUID();

    if (!annotation) {
      const newAnnotation: DynamicReferenceLineAnnotation = {
        highlighted: true,
        invalidated: true,
        metadata: {
          toolName: this.getToolName(),
          viewPlaneNormal: <Types.Point3>[...viewPlaneNormal],
          viewUp: <Types.Point3>[...viewUp],
          FrameOfReferenceUID,
          referencedImageId: undefined,
        },
        data: {
          handles: {
            points: sourceViewportCanvasCornersInWorld,
            activeOperation: null,
          },
          viewportProjections: {},
        },
      };

      addAnnotation(newAnnotation, element);
      annotation = newAnnotation;
    } else {
      this.editData.annotation.data.handles.points =
        sourceViewportCanvasCornersInWorld;
    }

    viewports.map((viewport) => {
      const projection = annotation.data.viewportProjections[viewport.id];
      if (!projection) {
        annotation.data.viewportProjections[viewport.id] = {
          highlighted: false,
        };
      }
      return {
        highlighted: false,
      };
    });

    this.editData = {
      sourceViewport,
      renderingEngine,
      annotation,
    };

    for (const viewport of viewports) {
      const { element } = viewport;
      this.interceptMouseEventsForElement(element);
    }

    triggerAnnotationRenderForViewportIds(
      renderingEngine,
      viewports
        .filter((viewport) => viewport.id !== sourceViewport.id)
        .map((viewport) => viewport.id)
    );
  };

  onSetToolEnabled = (): void => {
    this._init();
  };
  onSetToolActive = (): void => {
    this._init();
  };
  onSetToolPassive = (): void => {
    this._init();
  };

  onCameraModified = (evt: Types.EventTypes.CameraModifiedEvent): void => {
    // If the camera is modified, we need to update the reference lines
    // we really don't care which viewport triggered the
    // camera modification, since we want to update all of them
    // with respect to the targetViewport
    this._init();
  };

  filterInteractableAnnotationsForElement = (element, annotations) => {
    return annotations;
    // if (!annotations || !annotations.length) {
    //   return [];
    // }

    // const enabledElement = getEnabledElement(element);
    // const { viewportId } = enabledElement;

    // const viewportUIDSpecificReferenceLine = annotations.filter(
    //   (annotation) => annotation.data.viewportId === viewportId
    // );

    // return viewportUIDSpecificReferenceLine;
  };

  getHandleNearImagePoint(
    element: HTMLDivElement,
    annotation: DynamicReferenceLineAnnotation,
    canvasCoords: Types.Point2,
    proximity: number
  ): ToolHandle {
    const enabledElement = getEnabledElement(element);
    const { viewportId, viewport } = enabledElement;
    for (const vId in annotation.data.viewportProjections) {
      const dragHandles =
        annotation.data.viewportProjections[vId].dragHandlesCanvas;
      if (!dragHandles) {
        continue;
      }
      for (const handle of dragHandles) {
        if (vec2.distance(canvasCoords, handle) < proximity) {
          this.editData.annotation.data.handles.activeOperation = 'rotate';
          return viewport.canvasToWorld(handle);
        }
      }
    }
    return null;
  }

  mouseMoveCallback = (
    evt: MouseMoveEventType,
    filteredAnnotations?: Annotations
  ) => {
    const { element, currentPoints } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (enabledElement.viewportId === this.editData.sourceViewport?.id) {
      return;
    }
    const annotation = this.editData.annotation;
    if (!annotation) {
      return;
    }
    const viewportProjection =
      annotation.data.viewportProjections[enabledElement.viewportId];
    if (!viewportProjection) {
      return;
    }
    const wasHighlighted = viewportProjection.highlighted;
    let needsUpdate = false;
    if (
      annotation &&
      this.isPointNearTool(
        element,
        annotation as DynamicReferenceLineAnnotation,
        currentPoints.canvas,
        6
      )
    ) {
      if (!wasHighlighted) {
        needsUpdate = true;
        // Set other projections to not highlighted
        Object.values(annotation.data.viewportProjections).forEach(
          (proj) => (proj.highlighted = false)
        );
      }
      viewportProjection.highlighted = true;
    } else {
      if (wasHighlighted) {
        needsUpdate = true;
      }
      viewportProjection.highlighted = false;
    }

    return needsUpdate;
  };

  _activateModify = (element) => {
    // mobile sometimes has lingering interaction even when touchEnd triggers
    // this check allows for multiple handles to be active which doesn't affect
    // tool usage.
    state.isInteractingWithTool = !this.configuration.mobile?.enabled;

    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  _deactivateModify = (element) => {
    state.isInteractingWithTool = false;

    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  _endCallback = (evt: InteractionEventType) => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    this._deactivateModify(element);
  };

  _dragCallback = (evt: InteractionEventType) => {
    const eventDetail = evt.detail;
    const delta = eventDetail.deltaPoints.world;

    if (
      Math.abs(delta[0]) < 1e-3 &&
      Math.abs(delta[1]) < 1e-3 &&
      Math.abs(delta[2]) < 1e-3
    ) {
      return;
    }

    const { element } = eventDetail;
    const enabledElement = getEnabledElement(element);
    const { renderingEngine, viewport: targetViewport } = enabledElement;
    const { sourceViewport, annotation } = this.editData;

    const targetProjection =
      annotation.data.viewportProjections[targetViewport.id];

    const { handles } = annotation.data;
    const { currentPoints } = evt.detail;
    const canvasCoords = currentPoints.canvas;

    if (handles.activeOperation === 'drag') {
      // TRANSLATION

      if (sourceViewport.type === Enums.ViewportType.ORTHOGRAPHIC) {
        const deltaFromProjectedCenter = vec3.sub(
          vec3.create(),
          currentPoints.world,
          targetProjection.lineCenterWorld
        );
        this._applyDeltaShiftToSourceViewportCamera(
          deltaFromProjectedCenter as Types.Point3
        );
      } else {
        this._snapToNearestStackImage(currentPoints);
      }
    } else if (handles.activeOperation === 'rotate') {
      // ROTATION

      const dir1 = vec2.create();
      const dir2 = vec2.create();

      const sourceCenter = sourceViewport.getCamera().focalPoint;
      const centerCanvas = targetProjection.lineCenterCanvas;

      const finalPointCanvas = currentPoints.canvas;
      const originalPointCanvas = vec2.sub(
        vec2.create(),
        finalPointCanvas,
        eventDetail.deltaPoints.canvas
      );
      vec2.sub(dir1, originalPointCanvas, centerCanvas);
      vec2.sub(dir2, finalPointCanvas, centerCanvas);

      let angle = vec2.angle(dir1, dir2);

      if (
        this._isClockWise(centerCanvas, originalPointCanvas, finalPointCanvas)
      ) {
        angle *= -1;
      }

      // Rounding the angle to allow rotated handles to be undone
      // If we don't round and rotate handles clockwise by 0.0131233 radians,
      // there's no assurance that the counter-clockwise rotation occurs at
      // precisely -0.0131233, resulting in the drawn annotations being lost.
      // angle = Math.round(angle * 100) / 100;

      // const rotationAxis = sourceViewport.getCamera().viewPlaneNormal;
      // const rotationAxis = sourceViewport.getCamera().viewUp;

      // Rotation axis should be along the vector from the source viewport focal
      // point to the reference line center point
      const rotationAxis = vec3.subtract(
        vec3.create(),
        sourceCenter,
        targetProjection.lineCenterWorld
      );
      const {
        viewPlaneNormal: targetViewportNormal,
        focalPoint: targetFocalPoint,
      } = targetViewport.getCamera();
      const targetViewportPlane = csUtils.planar.planeEquation(
        targetViewportNormal,
        targetFocalPoint
      );
      const reverseAngle =
        csUtils.planar.planeDistanceToPoint(
          targetViewportPlane,
          sourceCenter,
          true
        ) < 0;
      if (reverseAngle) {
        angle = -angle;
      }

      // @ts-ignore : vtkjs incorrect typing
      const { matrix } = vtkMatrixBuilder
        .buildFromRadian()
        .translate(sourceCenter[0], sourceCenter[1], sourceCenter[2])
        // @ts-ignore
        .rotate(angle, rotationAxis) //todo: why we are passing
        .translate(-sourceCenter[0], -sourceCenter[1], -sourceCenter[2]);

      // update camera for the source viewport.
      const sourceCamera = sourceViewport.getCamera();
      const { viewUp, position, focalPoint } = sourceCamera;

      viewUp[0] += position[0];
      viewUp[1] += position[1];
      viewUp[2] += position[2];

      vec3.transformMat4(focalPoint, focalPoint, matrix);
      vec3.transformMat4(position, position, matrix);
      vec3.transformMat4(viewUp, viewUp, matrix);

      viewUp[0] -= position[0];
      viewUp[1] -= position[1];
      viewUp[2] -= position[2];

      sourceViewport.setCamera({
        position,
        viewUp,
        focalPoint,
      });

      sourceViewport.render();
    }
  };

  _isClockWise(a, b, c) {
    // return true if the rotation is clockwise
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
  }

  _snapToNearestStackImage(currentPoints: IPoints | ITouchPoints) {
    const { sourceViewport } = this.editData;
    // const sourceCamera = sourceViewport.getCamera();
    // const sourceNormal = sourceCamera.viewPlaneNormal;
    const sourceStackViewport = sourceViewport as Types.IStackViewport;
    const closestStackImageIndex = csUtils.getClosestStackImageIndexForPoint(
      currentPoints.world,
      sourceStackViewport
    );
    const currentImageIdIndex = sourceViewport.getCurrentImageIdIndex();
    // @ts-ignore
    sourceStackViewport.scroll(closestStackImageIndex - currentImageIdIndex);
  }

  _applyDeltaShiftToSourceViewportCamera(delta: Types.Point3) {
    // update camera for the other viewports.
    // NOTE1: The lines then are rendered by the onCameraModified
    // NOTE2: crosshair center are automatically updated in the onCameraModified event
    const { sourceViewport } = this.editData;
    const camera = sourceViewport.getCamera();
    const normal = camera.viewPlaneNormal;

    // Project delta over camera normal
    // (we don't need to pan, we need only to scroll the camera as in the wheel stack scroll tool)
    const dotProd = vtkMath.dot(delta, normal);
    const projectedDelta: Types.Point3 = [...normal];
    vtkMath.multiplyScalar(projectedDelta, dotProd);

    const volumeId = this.getTargetId(sourceViewport).split('volumeId:')[1];
    const { numScrollSteps, currentStepIndex, sliceRangeInfo } =
      csUtils.getVolumeViewportScrollInfo(
        sourceViewport as Types.IVolumeViewport,
        volumeId
      );
    const { min, max } = sliceRangeInfo.sliceRange;

    if (
      Math.abs(projectedDelta[0]) > 1e-3 ||
      Math.abs(projectedDelta[1]) > 1e-3 ||
      Math.abs(projectedDelta[2]) > 1e-3
    ) {
      const newFocalPoint: Types.Point3 = [0, 0, 0];
      const newPosition: Types.Point3 = [0, 0, 0];

      vtkMath.add(camera.focalPoint, projectedDelta, newFocalPoint);
      vtkMath.add(camera.position, projectedDelta, newPosition);

      const newSliceRange = csUtils.getSliceRange(
        sourceViewport.getActor(volumeId).actor as vtkVolume,
        normal,
        newFocalPoint
      );

      if (newSliceRange.current > max || newSliceRange.current < min) {
        return;
      }

      sourceViewport.setCamera({
        focalPoint: newFocalPoint,
        position: newPosition,
      });

      sourceViewport.render();
    }
  }

  updateRGBAlpha(colorString: string, alpha: string | number) {
    const rgbaValues = colorString.match(
      /rgba?\((\s*\d+\s*,\s*\d+\s*,\s*\d+)(?:\s*,.+?)?\)/
    );
    const rgbaColorString = `rgba(${rgbaValues[1]}, ${alpha})`;
    return rgbaColorString;
  }

  /**
   * it is used to draw the length annotation in each
   * request animation frame. It calculates the updated cached statistics if
   * data is invalidated and cache it.
   *
   * @param enabledElement - The Cornerstone's enabledElement.
   * @param svgDrawingHelper - The svgDrawingHelper providing the context for drawing.
   */
  renderAnnotation = (
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean => {
    const { viewport: targetViewport } = enabledElement;
    const { annotation, sourceViewport } = this.editData;

    let renderStatus = false;

    if (!sourceViewport || !sourceViewport.element.isConnected) {
      return renderStatus;
    }

    if (sourceViewport.id === targetViewport.id) {
      // If the source viewport is the same as the current viewport, we don't need to render
      return renderStatus;
    }

    if (!annotation || !annotation?.data?.handles?.points) {
      return renderStatus;
    }

    const viewportProjection =
      annotation.data.viewportProjections[targetViewport.id];

    const styleSpecifier: StyleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    // top left world, top right world, bottom right world, bottom left world
    const topLeft = annotation.data.handles.points[0];
    const topRight = annotation.data.handles.points[1];
    const bottomLeft = annotation.data.handles.points[2];
    const bottomRight = annotation.data.handles.points[3];

    const { focalPoint, viewPlaneNormal, viewUp } = targetViewport.getCamera();
    const {
      focalPoint: sourceFocalPoint,
      viewPlaneNormal: sourceViewPlaneNormal,
    } = sourceViewport.getCamera();

    if (this.isParallel(viewPlaneNormal, sourceViewPlaneNormal)) {
      // If the source and target viewports are parallel, we don't need to render
      return renderStatus;
    }

    const targetViewportPlane = csUtils.planar.planeEquation(
      viewPlaneNormal,
      focalPoint
    );

    // check if the topLeft and bottomLeft line is parallel to the viewUp
    const pointSet1 = [topLeft, bottomLeft, topRight, bottomRight];
    const pointSet2 = [topLeft, topRight, bottomLeft, bottomRight];

    let pointSetToUse = pointSet1;

    let topBottomVec = vec3.subtract(vec3.create(), pointSet1[0], pointSet1[1]);
    topBottomVec = vec3.normalize(vec3.create(), topBottomVec) as Types.Point3;

    let topRightVec = vec3.subtract(vec3.create(), pointSet1[2], pointSet1[0]);
    topRightVec = vec3.normalize(vec3.create(), topRightVec);

    const newNormal = vec3.cross(
      vec3.create(),
      topBottomVec,
      topRightVec
    ) as Types.Point3;

    if (this.isParallel(newNormal, viewPlaneNormal)) {
      return renderStatus;
    }

    // check if it is perpendicular to the viewPlaneNormal which means
    // the line does not intersect the viewPlaneNormal
    if (this.isPerpendicular(topBottomVec, viewPlaneNormal)) {
      // 'use pointSet2';
      pointSetToUse = pointSet2;
    }

    const lineStartWorld = csUtils.planar.linePlaneIntersection(
      pointSetToUse[0],
      pointSetToUse[1],
      targetViewportPlane
    );

    const lineEndWorld = csUtils.planar.linePlaneIntersection(
      pointSetToUse[2],
      pointSetToUse[3],
      targetViewportPlane
    );

    const { annotationUID } = annotation;

    styleSpecifier.annotationUID = annotationUID;
    const lineWidth = this.getStyle(
      'lineWidth',
      styleSpecifier,
      annotation
    ) as number;
    const lineDash = this.getStyle('lineDash', styleSpecifier, annotation);
    let color = this.getStyle('color', styleSpecifier, annotation);
    const shadow = this.getStyle('shadow', styleSpecifier, annotation);

    if (!viewportProjection.highlighted) {
      color = this.updateRGBAlpha(color as string, 0.5);
    }

    let canvasCoordinates = [lineStartWorld, lineEndWorld].map((world) =>
      targetViewport.worldToCanvas(world)
    );

    const boundedLineWorld = this.handleFullDimension(
      targetViewport,
      lineStartWorld,
      viewPlaneNormal,
      viewUp,
      lineEndWorld,
      canvasCoordinates
    );

    if (this.configuration.showFullDimension) {
      canvasCoordinates = boundedLineWorld.map((w) =>
        targetViewport.worldToCanvas(w)
      );
    }

    const dataId = `${annotationUID}-line`;
    const lineUID = '1';
    drawLineSvg(
      svgDrawingHelper,
      annotationUID,
      lineUID,
      canvasCoordinates[0],
      canvasCoordinates[1],
      {
        color,
        width: lineWidth,
        lineDash,
        shadow,
      },
      dataId
    );
    viewportProjection.lineCoordsCanvas = [
      canvasCoordinates[0],
      canvasCoordinates[1],
    ];

    // Draw Drag handles if highlighted

    if (viewportProjection.highlighted) {
      /**
       * Calculate the focal point of the referenced (source) image, and project
       * it onto the reference line. Then calculate the position of rotation drag
       * handles on the reference line and draw them.
       *
       * Example of how to calculate a perpendicular line from a point to another
       * line: https://math.stackexchange.com/a/4347547
       *
       * Since point 𝐷 will be on 𝐴𝐶 , then there exists a scalar 𝑡∈ℝ such
       * that
       *
       *   𝐷=𝐴+𝑡(𝐶−𝐴)(1)
       *
       *   The vector (𝐶−𝐴) is the direction vector of the ray 𝐴𝐶 . Now we
       *    want want 𝐵𝐷=𝐷−𝐵 to be perpendicular to (𝐶−𝐴) . Then using dot
       *    product we must have
       *
       *   [(𝐴−𝐵)+𝑡(𝐶−𝐴)]⋅(𝐶−𝐴)=0(2)
       *
       *   From which, 𝑡=(𝐵−𝐴)⋅(𝐶−𝐴)(𝐶−𝐴)⋅(𝐶−𝐴)(3)
       *
       *   Using 𝑡 from (3) into (1) gives the point 𝐷
       *
       */

      const refLineVector = vec3.subtract(
        vec3.create(),
        lineStartWorld,
        lineEndWorld
      );
      const focalPointToLineStartVector = vec3.subtract(
        vec3.create(),
        sourceFocalPoint,
        lineEndWorld
      );
      const distance =
        vec3.dot(refLineVector, focalPointToLineStartVector) /
        vec3.dot(refLineVector, refLineVector);

      // Position of the source image focal point projected on the reference
      // line (i.e. the line intersection of the source and target image
      // planes). This should represent the center of rotation on the reference
      // line.
      const refLineFocalPointProjWorld = vec3.scaleAndAdd(
        vec3.create(),
        lineEndWorld,
        refLineVector,
        distance
      );

      // Calculate drag handle positions in 2D space
      const canvasMinDimensionLength = Math.min(
        targetViewport.canvas.clientHeight,
        targetViewport.canvas.clientWidth
      );
      const focalPointToLineStartVec = vec2.subtract(
        vec2.create(),
        targetViewport.worldToCanvas(lineStartWorld),
        targetViewport.worldToCanvas(refLineFocalPointProjWorld as Types.Point3)
      );
      const rotationHandleDistanceVector = vec2.scale(
        vec2.create(),
        vec2.normalize(vec2.create(), focalPointToLineStartVec),
        canvasMinDimensionLength * 0.4 // How far from the center to draw the handles
      );
      const rotationHandle1 = vec2.add(
        vec2.create(),
        targetViewport.worldToCanvas(
          refLineFocalPointProjWorld as Types.Point3
        ),
        rotationHandleDistanceVector
      );
      const rotationHandle2 = vec2.subtract(
        vec2.create(),
        targetViewport.worldToCanvas(
          refLineFocalPointProjWorld as Types.Point3
        ),
        rotationHandleDistanceVector
      );

      drawHandlesSvg(
        svgDrawingHelper,
        annotationUID,
        'rotateHandles',
        [
          // targetViewport.worldToCanvas(
          //   refLineFocalPointProjWorld as Types.Point3
          // ),
          rotationHandle1 as Types.Point2,
          rotationHandle2 as Types.Point2,
        ],
        {
          color,
          handleRadius: this.configuration.mobile?.enabled
            ? this.configuration.mobile?.handleRadius
            : 3,
          opacity: this.configuration.mobile?.enabled
            ? this.configuration.mobile?.opacity
            : 1,
          type: 'circle',
        }
      );

      // Update tool data
      viewportProjection.dragHandlesCanvas = [
        rotationHandle1 as Types.Point2,
        rotationHandle2 as Types.Point2,
      ];
      viewportProjection.lineCenterCanvas = targetViewport.worldToCanvas(
        refLineFocalPointProjWorld as Types.Point3
      );
      viewportProjection.lineCenterWorld =
        refLineFocalPointProjWorld as Types.Point3;
    }

    // Finished rendering
    renderStatus = true;

    return renderStatus;
  };

  isPerpendicular = (vec1: Types.Point3, vec2: Types.Point3): boolean => {
    const dot = vec3.dot(vec1, vec2);
    return Math.abs(dot) < EPSILON;
  };

  private handleFullDimension(
    targetViewport: Types.IStackViewport | Types.IVolumeViewport,
    lineStartWorld: Types.Point3,
    viewPlaneNormal: Types.Point3,
    viewUp: Types.Point3,
    lineEndWorld: Types.Point3,
    canvasCoordinates: Types.Point2[]
  ) {
    const renderingEngine = targetViewport.getRenderingEngine();
    const targetId = this.getTargetId(targetViewport);
    const targetImage = this.getTargetIdImage(targetId, renderingEngine);

    const referencedImageId = this.getReferencedImageId(
      targetViewport,
      lineStartWorld,
      viewPlaneNormal,
      viewUp
    );

    if (referencedImageId && targetImage) {
      try {
        const { imageData, dimensions } = targetImage;

        // Calculate bound image coordinates
        const [
          topLeftImageCoord,
          topRightImageCoord,
          bottomRightImageCoord,
          bottomLeftImageCoord,
        ] = [
          imageData.indexToWorld([0, 0, 0]) as Types.Point3,
          imageData.indexToWorld([dimensions[0] - 1, 0, 0]) as Types.Point3,
          imageData.indexToWorld([
            dimensions[0] - 1,
            dimensions[1] - 1,
            0,
          ]) as Types.Point3,
          imageData.indexToWorld([0, dimensions[1] - 1, 0]) as Types.Point3,
        ].map((world) => csUtils.worldToImageCoords(referencedImageId, world));

        // Calculate line start and end image coordinates
        const [lineStartImageCoord, lineEndImageCoord] = [
          lineStartWorld,
          lineEndWorld,
        ].map((world) => csUtils.worldToImageCoords(referencedImageId, world));

        // Calculate intersection points between line and image bounds
        return [
          [topLeftImageCoord, topRightImageCoord],
          [topRightImageCoord, bottomRightImageCoord],
          [bottomLeftImageCoord, bottomRightImageCoord],
          [topLeftImageCoord, bottomLeftImageCoord],
        ]
          .map(([start, end]) =>
            this.intersectInfiniteLines(
              start,
              end,
              lineStartImageCoord,
              lineEndImageCoord
            )
          )
          .filter((point) => point && this.isInBound(point, dimensions))
          .map((point) => {
            const world = csUtils.imageToWorldCoords(
              referencedImageId,
              point as Types.Point2
            );
            // return targetViewport.worldToCanvas(world);
            return world;
          });
      } catch (err) {
        console.log(err);
      }
    }
  }

  // get the intersection point between two infinite lines, not line segments
  intersectInfiniteLines(
    line1Start: Types.Point2,
    line1End: Types.Point2,
    line2Start: Types.Point2,
    line2End: Types.Point2
  ) {
    const [x1, y1] = line1Start;
    const [x2, y2] = line1End;
    const [x3, y3] = line2Start;
    const [x4, y4] = line2End;

    // Compute a1, b1, c1, where line joining points 1 and 2 is "a1 x  +  b1 y  +  c1  =  0"
    const a1 = y2 - y1;
    const b1 = x1 - x2;
    const c1 = x2 * y1 - x1 * y2;

    // Compute a2, b2, c2
    const a2 = y4 - y3;
    const b2 = x3 - x4;
    const c2 = x4 * y3 - x3 * y4;

    if (Math.abs(a1 * b2 - a2 * b1) < EPSILON) {
      return;
    }

    const x = (b1 * c2 - b2 * c1) / (a1 * b2 - a2 * b1);
    const y = (a2 * c1 - a1 * c2) / (a1 * b2 - a2 * b1);

    return [x, y];
  }

  isParallel(vec1: Types.Point3, vec2: Types.Point3): boolean {
    return Math.abs(vec3.dot(vec1, vec2)) > 1 - EPSILON;
  }

  isInBound(point: number[], dimensions: Types.Point3): boolean {
    return (
      point[0] >= 0 &&
      point[0] <= dimensions[0] &&
      point[1] >= 0 &&
      point[1] <= dimensions[1]
    );
  }

  /**
   * It returns if the canvas point is near the provided length annotation in the provided
   * element or not. A proximity is passed to the function to determine the
   * proximity of the point to the annotation in number of pixels.
   *
   * @param element - HTML Element
   * @param annotation - Annotation
   * @param canvasCoords - Canvas coordinates
   * @param proximity - Proximity to tool to consider
   * @returns Boolean, whether the canvas point is near tool
   */
  isPointNearTool = (
    element: HTMLDivElement,
    annotation: DynamicReferenceLineAnnotation,
    canvasCoords: Types.Point2,
    proximity: number
  ): boolean => {
    const enabledElement = getEnabledElement(element);
    const { viewportId } = enabledElement;
    const { data } = annotation;
    const viewportToolProjections = data.viewportProjections[viewportId];
    if (!viewportToolProjections) {
      console.warn('No tool projection for viewport id ', viewportId);
      return;
    }
    if (!viewportToolProjections.lineCoordsCanvas) {
      return;
    }

    const line = {
      start: {
        x: viewportToolProjections.lineCoordsCanvas[0][0],
        y: viewportToolProjections.lineCoordsCanvas[0][1],
      },
      end: {
        x: viewportToolProjections.lineCoordsCanvas[1][0],
        y: viewportToolProjections.lineCoordsCanvas[1][1],
      },
    };

    const distanceToPoint = lineSegment.distanceToPoint(
      [line.start.x, line.start.y],
      [line.end.x, line.end.y],
      [canvasCoords[0], canvasCoords[1]]
    );

    if (distanceToPoint <= proximity) {
      this.editData.annotation.data.handles.activeOperation = 'drag';
      return true;
    }

    return false;
  };
}

DynamicReferenceLines.toolName = 'DynamicReferenceLines';
export default DynamicReferenceLines;
