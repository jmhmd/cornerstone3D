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
import {
  PublicToolProps,
  ToolProps,
  SVGDrawingHelper,
  Annotations,
  Annotation,
  InteractionTypes,
  ToolHandle,
} from '../types';
import { DynamicReferenceLineAnnotation } from '../types/ToolSpecificAnnotationTypes';
import { StyleSpecifier } from '../types/AnnotationStyle';
// import AnnotationDisplayTool from './base/AnnotationDisplayTool';
import { AnnotationTool } from './base';
import * as lineSegment from '../utilities/math/line';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { InteractionEventType, MouseMoveEventType } from '../types/EventTypes';

const { EPSILON } = CONSTANTS;

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
    console.log('handleSelectedCallback not implemented');
    return;
  }

  toolSelectedCallback(
    evt: InteractionEventType,
    annotation: Annotation,
    interactionType: InteractionTypes
  ): void {
    console.log('toolSelectedCallback not implemented');
    return;
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
    }),
      (this.editData = {
        sourceViewport,
        renderingEngine,
        annotation,
      });

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
    const viewportProjection =
      annotation.data.viewportProjections[enabledElement.viewportId];
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

    const viewportProjection =
      annotation.data.viewportProjections[targetViewport.id];

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
    const lineWidth = this.getStyle(
      'lineWidth',
      styleSpecifier,
      annotation
    ) as number;
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
      return true;
    }

    return false;
  };
}

DynamicReferenceLines.toolName = 'DynamicReferenceLines';
export default DynamicReferenceLines;
