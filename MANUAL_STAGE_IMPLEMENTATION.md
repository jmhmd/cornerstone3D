# Manual Stage Loading Implementation

## Summary

This implementation adds support for manual stage triggering in progressive image loading. Stages can be marked with `manual: true` to pause automatic progression, requiring explicit calls to `loadNextImageLoadStage(imageId)` to continue.

## Changes Made

### 1. Type Definition (`packages/core/src/types/IRetrieveConfiguration.ts`)

Added `manual?: boolean` flag to `RetrieveStage` interface:

```typescript
export interface RetrieveStage {
  // ... existing fields
  /**
   * If true, this stage will not automatically execute after the previous stage.
   * Instead, it must be manually triggered via loadNextImageLoadStage(imageId).
   */
  manual?: boolean;
}
```

### 2. Core Implementation (`packages/core/src/loaders/ProgressiveRetrieveImages.ts`)

#### Added:
- Global `activeInstances` Map to track running instances
- `pendingManualRequests` Map on each instance to store paused stages
- `triggerNextManualStage(imageId)` public method on instance
- Modified stage chaining logic to check `manual` flag
- Instance registration/cleanup in `loadImages()`
- `loadNextImageLoadStage(imageId)` exported function

### 3. Public API (`packages/core/src/index.ts`)

Exported `loadNextImageLoadStage` function for external use.

## Total Lines Changed: ~30 lines

## Usage

### Basic Example

```typescript
import {
  loadNextImageLoadStage,
  Events,
  eventTarget
} from '@cornerstonejs/core';

// Configure stages with manual trigger points
const retrieveConfiguration = {
  stages: [
    {
      id: 'thumbnail',
      retrieveType: 'singleFast',
      rangeIndex: 0,
      chunkSize: 64 * 1024,
    },
    {
      id: 'fullResolution',
      retrieveType: 'singleFinal',
      rangeIndex: -1,
      manual: true,  // ← Requires manual trigger
    },
  ],
  retrieveOptions: {
    singleFast: {
      imageQualityStatus: ImageQualityStatus.SUBRESOLUTION,
    },
    singleFinal: {
      imageQualityStatus: ImageQualityStatus.FULL_RESOLUTION,
    },
  },
};

// Set up stage completion listener
eventTarget.addEventListener(Events.IMAGE_RETRIEVAL_STAGE, (evt) => {
  const { stageId, numberOfImages } = evt.detail;
  console.log(`Stage ${stageId} completed: ${numberOfImages} images`);

  if (stageId === 'thumbnail') {
    console.log('Thumbnail loaded. Waiting for user to request full resolution.');
  }
});

// Load images - will auto-load thumbnail, then pause
await viewport.setStack(imageIds, 0, retrieveConfiguration);

// Later, when user clicks "Load Full Resolution" button:
const success = loadNextImageLoadStage(imageIds[0]);
if (success) {
  console.log('Loading full resolution...');
} else {
  console.log('No pending manual stage found');
}
```

### Advanced Example: Multi-Stage Progressive Loading

```typescript
const htj2kMultiStageConfig = {
  stages: [
    {
      id: 'initial',
      retrieveType: 'fast',
      rangeIndex: 0,
      chunkSize: 128 * 1024,
      priority: 5,
    },
    {
      id: 'userRequested',
      retrieveType: 'medium',
      rangeIndex: 5,
      manual: true,  // ← Pause here
      priority: 10,
    },
    {
      id: 'intermediate',
      retrieveType: 'better',
      rangeIndex: 10,
      priority: 15,
    },
    {
      id: 'final',
      retrieveType: 'full',
      rangeIndex: -1,
      manual: true,  // ← Pause here too
      priority: 20,
    },
  ],
  retrieveOptions: {
    fast: { decodeLevel: 2, chunkSize: 128 * 1024, rangeIndex: 0 },
    medium: { decodeLevel: 1, rangeIndex: 5 },
    better: { decodeLevel: 0, rangeIndex: 10 },
    full: { rangeIndex: -1 },
  },
};

// Flow:
// 1. initial stage loads automatically
// 2. PAUSES at userRequested (manual: true)
// 3. User calls loadNextImageLoadStage(imageId)
// 4. userRequested stage loads
// 5. intermediate stage loads automatically (no manual flag)
// 6. PAUSES at final (manual: true)
// 7. User calls loadNextImageLoadStage(imageId) again
// 8. final stage loads
```

## Behavior

### Stage Execution Flow

Each stage independently checks if its **successor** is marked `manual`:

1. When a stage completes, it checks `next.stage.manual`
2. If `manual === true`: stores the next request, doesn't execute it
3. If `manual === false/undefined`: automatically executes the next stage
4. Chain continues until hitting another manual stage or completion

### Key Points

- ✅ Manual stages create **breakpoints** in the loading chain
- ✅ Non-manual stages **auto-run** after being triggered
- ✅ Only need to call `loadNextImageLoadStage()` **once per manual stage**
- ✅ The chain resumes automatically until the next manual stage
- ✅ **Backward compatible**: existing code without `manual` flag works unchanged

## API Reference

### `loadNextImageLoadStage(imageId: string): boolean`

Manually triggers the next stage of progressive loading for a given imageId.

**Parameters:**
- `imageId` - The imageId to load the next stage for

**Returns:**
- `true` if a pending manual stage was found and triggered
- `false` if no instance or pending manual stage exists

**Example:**
```typescript
if (loadNextImageLoadStage(imageId)) {
  console.log('Next stage triggered');
} else {
  console.log('No pending manual stage');
}
```

## Implementation Details

### Instance Lifecycle

- Instances are registered in `activeInstances` Map when `loadImages()` is called
- Instances are unregistered when loading completes (via `.finally()`)
- Each imageId maps to its loading instance for manual triggering

### Memory Management

- Pending manual requests are stored only while the instance is active
- Cleanup happens automatically when loading completes
- No memory leaks: instances are removed from registry on completion

### Thread Safety

- All operations are synchronous within the JavaScript event loop
- No race conditions: manual triggers are processed in order
- Safe to call `loadNextImageLoadStage()` from event handlers

## Testing

To test the implementation:

1. Create a retrieve configuration with manual stages
2. Load images and verify initial stages complete
3. Verify loading pauses at manual stages
4. Call `loadNextImageLoadStage(imageId)` and verify continuation
5. Listen to `Events.IMAGE_RETRIEVAL_STAGE` for stage completion

## Notes

- The `manual` flag is **optional** - omitting it maintains default auto-run behavior
- Multiple imageIds can have independent manual stage states
- Manual stages can be placed at any position in the stage chain
- Works with all retrieve types: streaming, range, and standard
