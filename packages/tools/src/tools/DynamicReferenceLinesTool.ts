import { vec2, vec3 } from 'gl-matrix';
import {
  getRenderingEngines,
  CONSTANTS,
  utilities as csUtils,
  Enums,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import { addAnnotation } from '../stateManagement/annotation/annotationState';

import {
  drawLine as drawLineSvg,
  drawHandles as drawHandlesSvg,
} from '../drawingSvg';
import { filterViewportsWithToolEnabled } from '../utilities/viewportFilters';
import triggerAnnotationRenderForViewportIds from '../utilities/triggerAnnotationRenderForViewportIds';
import { PublicToolProps, ToolProps, SVGDrawingHelper } from '../types';
import { ReferenceLineAnnotation } from '../types/ToolSpecificAnnotationTypes';
import { StyleSpecifier } from '../types/AnnotationStyle';
import AnnotationDisplayTool from './base/AnnotationDisplayTool';
import {
  calculateLinesAndHandles,
  drawLinesAndHandles,
} from './DynamicReferenceLinesUtil';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';

const { EPSILON } = CONSTANTS;

/**
 * @public
 */

class DynamicReferenceLines extends AnnotationDisplayTool {
  static toolName;

  public touchDragCallback: any;
  public mouseDragCallback: any;
  _throttledCalculateCachedStats: any;
  editData: {
    renderingEngine: Types.IRenderingEngine;
    sourceViewport: Types.IStackViewport | Types.IVolumeViewport;
    annotation: ReferenceLineAnnotation;
  } | null = {} as any;
  isDrawing: boolean;
  isHandleOutsideImage: boolean;

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

    // this._throttledCalculateCachedStats = throttle(
    //   this._calculateCachedStats,
    //   100,
    //   { trailing: true }
    // );
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
      const newAnnotation: ReferenceLineAnnotation = {
        highlighted: true,
        invalidated: true,
        metadata: {
          toolName: this.getToolName(),
          viewPlaneNormal: <Types.Point3>[...viewPlaneNormal],
          viewUp: <Types.Point3>[...viewUp],
          FrameOfReferenceUID,
          referencedImageId: null,
        },
        data: {
          handles: {
            points: sourceViewportCanvasCornersInWorld,
          },
        },
      };

      addAnnotation(newAnnotation, element);
      annotation = newAnnotation;
    } else {
      this.editData.annotation.data.handles.points =
        sourceViewportCanvasCornersInWorld;
    }

    this.editData = {
      sourceViewport,
      renderingEngine,
      annotation,
    };

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

  onCameraModified = (evt: Types.EventTypes.CameraModifiedEvent): void => {
    // If the camera is modified, we need to update the reference lines
    // we really don't care which viewport triggered the
    // camera modification, since we want to update all of them
    // with respect to the targetViewport
    this._init();
  };

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

    if (!sourceViewport) {
      return renderStatus;
    }

    if (sourceViewport.id === targetViewport.id) {
      // If the source viewport is the same as the current viewport, we don't need to render
      return renderStatus;
    }

    if (!annotation || !annotation?.data?.handles?.points) {
      return renderStatus;
    }

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
    const lineWidth = this.getStyle('lineWidth', styleSpecifier, annotation);
    const lineDash = this.getStyle('lineDash', styleSpecifier, annotation);
    const color = this.getStyle('color', styleSpecifier, annotation);
    const shadow = this.getStyle('shadow', styleSpecifier, annotation);

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

    /**
     * https://math.stackexchange.com/a/4347547
Since point 𝐷
 will be on 𝐴𝐶
, then there exists a scalar 𝑡∈ℝ
 such that

𝐷=𝐴+𝑡(𝐶−𝐴)(1)

The vector (𝐶−𝐴)
 is the direction vector of the ray 𝐴𝐶
. Now we want want 𝐵𝐷=𝐷−𝐵
 to be perpendicular to (𝐶−𝐴)
. Then using dot product we must have

[(𝐴−𝐵)+𝑡(𝐶−𝐴)]⋅(𝐶−𝐴)=0(2)

From which, 𝑡=(𝐵−𝐴)⋅(𝐶−𝐴)(𝐶−𝐴)⋅(𝐶−𝐴)(3)

Using 𝑡
 from (3)
 into (1)
 gives the point 𝐷
.
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
    const refLineFocalPointProjWorld = vec3.scaleAndAdd(
      vec3.create(),
      lineEndWorld,
      refLineVector,
      distance
    );
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
      canvasMinDimensionLength * 0.4
    );
    const rotationHandle1 = vec2.add(
      vec2.create(),
      targetViewport.worldToCanvas(refLineFocalPointProjWorld as Types.Point3),
      rotationHandleDistanceVector
    );
    const rotationHandle2 = vec2.subtract(
      vec2.create(),
      targetViewport.worldToCanvas(refLineFocalPointProjWorld as Types.Point3),
      rotationHandleDistanceVector
    );

    drawHandlesSvg(
      svgDrawingHelper,
      'newuid',
      'rotateHandles',
      [
        targetViewport.worldToCanvas(
          refLineFocalPointProjWorld as Types.Point3
        ),
        rotationHandle1 as Types.Point2,
        rotationHandle2 as Types.Point2,
      ],
      {
        color: 'rgb(255, 0, 0)',
        handleRadius: this.configuration.mobile?.enabled
          ? this.configuration.mobile?.handleRadius
          : 3,
        opacity: this.configuration.mobile?.enabled
          ? this.configuration.mobile?.opacity
          : 1,
        type: 'circle',
      }
    );

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

  /*

  setSlabThickness(viewport, slabThickness) {
    // let actorUIDs;
    // const { filterActorUIDsToSetSlabThickness } = this.configuration;
    // if (
    //   filterActorUIDsToSetSlabThickness &&
    //   filterActorUIDsToSetSlabThickness.length > 0
    // ) {
    //   actorUIDs = filterActorUIDsToSetSlabThickness;
    // }

    let blendModeToUse = this.configuration.slabThicknessBlendMode;
    if (slabThickness === CONSTANTS.RENDERING_DEFAULTS.MINIMUM_SLAB_THICKNESS) {
      blendModeToUse = Enums.BlendModes.COMPOSITE;
    }

    const immediate = false;
    viewport.setBlendMode(blendModeToUse, actorUIDs, immediate);
    viewport.setSlabThickness(slabThickness, actorUIDs);
  }

  _applyDeltaShiftToViewportCamera(
    renderingEngine: Types.IRenderingEngine,
    annotation,
    delta
  ) {
    // update camera for the other viewports.
    // NOTE1: The lines then are rendered by the onCameraModified
    // NOTE2: crosshair center are automatically updated in the onCameraModified event
    const { data } = annotation;

    const viewport = renderingEngine.getViewport(data.viewportId);
    const camera = viewport.getCamera();
    const normal = camera.viewPlaneNormal;

    // Project delta over camera normal
    // (we don't need to pan, we need only to scroll the camera as in the wheel stack scroll tool)
    const dotProd = vtkMath.dot(delta, normal);
    const projectedDelta: Types.Point3 = [...normal];
    vtkMath.multiplyScalar(projectedDelta, dotProd);

    if (
      Math.abs(projectedDelta[0]) > 1e-3 ||
      Math.abs(projectedDelta[1]) > 1e-3 ||
      Math.abs(projectedDelta[2]) > 1e-3
    ) {
      const newFocalPoint: Types.Point3 = [0, 0, 0];
      const newPosition: Types.Point3 = [0, 0, 0];

      vtkMath.add(camera.focalPoint, projectedDelta, newFocalPoint);
      vtkMath.add(camera.position, projectedDelta, newPosition);

      viewport.setCamera({
        focalPoint: newFocalPoint,
        position: newPosition,
      });
      viewport.render();
    }
  }

  _pointNearReferenceLine = (
    annotation,
    canvasCoords,
    proximity,
    lineViewport
  ) => {
    const { data } = annotation;
    const { rotationPoints } = data.handles;

    for (let i = 0; i < rotationPoints.length - 1; ++i) {
      const otherViewport = rotationPoints[i][1];
      if (otherViewport.id !== lineViewport.id) {
        continue;
      }

      const viewportControllable = this._getReferenceLineControllable(
        otherViewport.id
      );
      if (!viewportControllable) {
        continue;
      }

      const lineSegment1 = {
        start: {
          x: rotationPoints[i][2][0],
          y: rotationPoints[i][2][1],
        },
        end: {
          x: rotationPoints[i][3][0],
          y: rotationPoints[i][3][1],
        },
      };

      const distanceToPoint1 = lineSegment.distanceToPoint(
        [lineSegment1.start.x, lineSegment1.start.y],
        [lineSegment1.end.x, lineSegment1.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      const lineSegment2 = {
        start: {
          x: rotationPoints[i + 1][2][0],
          y: rotationPoints[i + 1][2][1],
        },
        end: {
          x: rotationPoints[i + 1][3][0],
          y: rotationPoints[i + 1][3][1],
        },
      };

      const distanceToPoint2 = lineSegment.distanceToPoint(
        [lineSegment2.start.x, lineSegment2.start.y],
        [lineSegment2.end.x, lineSegment2.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      if (distanceToPoint1 <= proximity || distanceToPoint2 <= proximity) {
        return true;
      }

      // rotation handles are two for viewport
      i++;
    }

    return false;
  };

  _getRotationHandleNearImagePoint(
    viewport,
    annotation,
    canvasCoords,
    proximity
  ) {
    const { data } = annotation;
    const { rotationPoints } = data.handles;

    for (let i = 0; i < rotationPoints.length; i++) {
      const point = rotationPoints[i][0];
      const otherViewport = rotationPoints[i][1];
      const viewportControllable = this._getReferenceLineControllable(
        otherViewport.id
      );
      if (!viewportControllable) {
        continue;
      }

      const viewportDraggableRotatable =
        this._getReferenceLineDraggableRotatable(otherViewport.id);
      if (!viewportDraggableRotatable) {
        continue;
      }

      const annotationCanvasCoordinate = viewport.worldToCanvas(point);
      if (vec2.distance(canvasCoords, annotationCanvasCoordinate) < proximity) {
        data.handles.activeOperation = OPERATION.ROTATE;

        this.editData = {
          annotation,
        };

        return point;
      }
    }

    return null;
  }

  _getSlabThicknessHandleNearImagePoint(
    viewport,
    annotation,
    canvasCoords,
    proximity
  ) {
    const { data } = annotation;
    const { slabThicknessPoints } = data.handles;

    for (let i = 0; i < slabThicknessPoints.length; i++) {
      const point = slabThicknessPoints[i][0];
      const otherViewport = slabThicknessPoints[i][1];
      const viewportControllable = this._getReferenceLineControllable(
        otherViewport.id
      );
      if (!viewportControllable) {
        continue;
      }

      const viewportSlabThicknessControlsOn =
        this._getReferenceLineSlabThicknessControlsOn(otherViewport.id);
      if (!viewportSlabThicknessControlsOn) {
        continue;
      }

      const annotationCanvasCoordinate = viewport.worldToCanvas(point);
      if (vec2.distance(canvasCoords, annotationCanvasCoordinate) < proximity) {
        data.handles.activeOperation = OPERATION.SLAB;

        data.activeViewportIds = [otherViewport.id];

        this.editData = {
          annotation,
        };

        return point;
      }
    }

    return null;
  }

  _pointNearTool(element, annotation, canvasCoords, proximity) {
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const { clientWidth, clientHeight } = viewport.canvas;
    const canvasDiagonalLength = Math.sqrt(
      clientWidth * clientWidth + clientHeight * clientHeight
    );
    const { data } = annotation;

    const { rotationPoints } = data.handles;
    const { slabThicknessPoints } = data.handles;
    const viewportIdArray = [];

    for (let i = 0; i < rotationPoints.length - 1; ++i) {
      const otherViewport = rotationPoints[i][1];
      const viewportControllable = this._getReferenceLineControllable(
        otherViewport.id
      );
      const viewportDraggableRotatable =
        this._getReferenceLineDraggableRotatable(otherViewport.id);

      if (!viewportControllable || !viewportDraggableRotatable) {
        continue;
      }

      const lineSegment1 = {
        start: {
          x: rotationPoints[i][2][0],
          y: rotationPoints[i][2][1],
        },
        end: {
          x: rotationPoints[i][3][0],
          y: rotationPoints[i][3][1],
        },
      };

      const distanceToPoint1 = lineSegment.distanceToPoint(
        [lineSegment1.start.x, lineSegment1.start.y],
        [lineSegment1.end.x, lineSegment1.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      const lineSegment2 = {
        start: {
          x: rotationPoints[i + 1][2][0],
          y: rotationPoints[i + 1][2][1],
        },
        end: {
          x: rotationPoints[i + 1][3][0],
          y: rotationPoints[i + 1][3][1],
        },
      };

      const distanceToPoint2 = lineSegment.distanceToPoint(
        [lineSegment2.start.x, lineSegment2.start.y],
        [lineSegment2.end.x, lineSegment2.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      if (distanceToPoint1 <= proximity || distanceToPoint2 <= proximity) {
        viewportIdArray.push(otherViewport.id);
        data.handles.activeOperation = OPERATION.DRAG;
      }

      // rotation handles are two for viewport
      i++;
    }

    for (let i = 0; i < slabThicknessPoints.length - 1; ++i) {
      const otherViewport = slabThicknessPoints[i][1];
      if (viewportIdArray.find((id) => id === otherViewport.id)) {
        continue;
      }

      const viewportControllable = this._getReferenceLineControllable(
        otherViewport.id
      );
      const viewportSlabThicknessControlsOn =
        this._getReferenceLineSlabThicknessControlsOn(otherViewport.id);

      if (!viewportControllable || !viewportSlabThicknessControlsOn) {
        continue;
      }

      const stPointLineCanvas1 = slabThicknessPoints[i][2];
      const stPointLineCanvas2 = slabThicknessPoints[i][3];

      const centerCanvas = vec2.create();
      vec2.add(centerCanvas, stPointLineCanvas1, stPointLineCanvas2);
      vec2.scale(centerCanvas, centerCanvas, 0.5);

      const canvasUnitVectorFromCenter = vec2.create();
      vec2.subtract(
        canvasUnitVectorFromCenter,
        stPointLineCanvas1,
        centerCanvas
      );
      vec2.normalize(canvasUnitVectorFromCenter, canvasUnitVectorFromCenter);

      const canvasVectorFromCenterStart = vec2.create();
      vec2.scale(
        canvasVectorFromCenterStart,
        canvasUnitVectorFromCenter,
        canvasDiagonalLength * 0.05
      );

      const stPointLineCanvas1Start = vec2.create();
      const stPointLineCanvas2Start = vec2.create();
      vec2.add(
        stPointLineCanvas1Start,
        centerCanvas,
        canvasVectorFromCenterStart
      );
      vec2.subtract(
        stPointLineCanvas2Start,
        centerCanvas,
        canvasVectorFromCenterStart
      );

      const lineSegment1 = {
        start: {
          x: stPointLineCanvas1Start[0],
          y: stPointLineCanvas1Start[1],
        },
        end: {
          x: stPointLineCanvas1[0],
          y: stPointLineCanvas1[1],
        },
      };

      const distanceToPoint1 = lineSegment.distanceToPoint(
        [lineSegment1.start.x, lineSegment1.start.y],
        [lineSegment1.end.x, lineSegment1.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      const lineSegment2 = {
        start: {
          x: stPointLineCanvas2Start[0],
          y: stPointLineCanvas2Start[1],
        },
        end: {
          x: stPointLineCanvas2[0],
          y: stPointLineCanvas2[1],
        },
      };

      const distanceToPoint2 = lineSegment.distanceToPoint(
        [lineSegment2.start.x, lineSegment2.start.y],
        [lineSegment2.end.x, lineSegment2.end.y],
        [canvasCoords[0], canvasCoords[1]]
      );

      if (distanceToPoint1 <= proximity || distanceToPoint2 <= proximity) {
        viewportIdArray.push(otherViewport.id); // we still need this to draw inactive slab thickness handles
        data.handles.activeOperation = null; // no operation
      }

      // slab thickness handles are in couples
      i++;
    }

    data.activeViewportIds = [...viewportIdArray];

    this.editData = {
      annotation,
    };

    return data.handles.activeOperation === OPERATION.DRAG ? true : false;
  }
  */
}

DynamicReferenceLines.toolName = 'DynamicReferenceLines';
export default DynamicReferenceLines;
