goog.provide('shaka.abr.SlidingPercentile');


/**
 * @summary
 * <p>
 * SlidingPercentile from Exoplayer2
 * https://github.com/google/ExoPlayer/blob/release-v2/library/core/src/main/
 * java/com/google/android/exoplayer2/util/SlidingPercentile.java
 * </p>
 *
 * @export
 */
shaka.abr.SlidingPercentile = class {
  /**
   * @param {number} maxWeight The maximum weight.
   */
  constructor(maxWeight) {
    /** @private {number} */
    this.maxWeight = maxWeight;

    /** @private {!Array.<shaka.abr.SlidingPercentile.Sample_>} */
    this.recycledSamples = [];

    /** @private {!Array.<shaka.abr.SlidingPercentile.Sample_>} */
    this.samples = [];

    /** @private {number} */
    this.currentSortOrder = shaka.abr.SlidingPercentile.SortOrder.NONE;

    /** @private {number} */
    this.nextSampleIndex = 0;

    /** @private {number} */
    this.totalWeight = 0;

    /** @private {number} */
    this.recycledSampleCount = 0;
  }

  /** Resets the sliding percentile. */
  reset() {
    this.samples = [];
    this.currentSortOrder = shaka.abr.SlidingPercentile.SortOrder.NONE;
    this.nextSampleIndex = 0;
    this.totalWeight = 0;
  }

  /**
   * Adds a new weighted value.
   *
   * @param {number} weight The weight of the new observation.
   * @param {number} value The value of the new observation.
   * @export
   */
  addSample(weight, value) {
    this.ensureSortedByIndex_();
    const newSample = this.recycledSampleCount > 0 ?
        this.recycledSamples.pop() :
        this.createSample_();
    newSample.index = this.nextSampleIndex++;
    newSample.weight = weight;
    newSample.value = value;
    this.samples.push(newSample);
    this.totalWeight += weight;

    while (this.totalWeight > this.maxWeight && this.samples.length > 0) {
      const excessWeight = this.totalWeight - this.maxWeight;
      const oldestSample = this.samples[0];
      if (oldestSample.weight <= excessWeight) {
        this.totalWeight -= oldestSample.weight;
        this.samples.shift();
        if (this.recycledSampleCount <
            shaka.abr.SlidingPercentile.MAX_RECYCLED_SAMPLES) {
          this.recycledSamples.push(oldestSample);
        }
      } else {
        oldestSample.weight -= excessWeight;
        this.totalWeight -= excessWeight;
      }
    }
  }

  /**
   * Computes a percentile by integration.
   *
   * @param {number} percentile The desired percentile, expressed as
   * a fraction in the range (0,1].
   * @return {number} The requested percentile value or NaN if no samples
   * have been added.
   * @export
   */
  getPercentile(percentile) {
    this.ensureSortedByValue_();
    const desiredWeight = percentile * this.totalWeight;
    let accumulatedWeight = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const currentSample = this.samples[i];
      accumulatedWeight += currentSample.weight;
      if (accumulatedWeight >= desiredWeight) {
        return currentSample.value;
      }
    }
    return this.samples.length === 0 ? NaN :
        this.samples[this.samples.length - 1].value;
  }

  /**
    * Sorts the samples by index.
    * @private
    */
  ensureSortedByIndex_() {
    const sortOrder = shaka.abr.SlidingPercentile.SortOrder;
    if (this.currentSortOrder != sortOrder.BY_INDEX) {
      this.samples.sort((a, b) => (
        a.index == b.index ? 0 :
        a.index < b.index ? -1 : 1
      ));
      this.currentSortOrder = sortOrder.BY_INDEX;
    }
  }

  /**
   * Sorts the samples by value.
   * @private
   */
  ensureSortedByValue_() {
    const sortOrder = shaka.abr.SlidingPercentile.SortOrder;
    if (this.currentSortOrder != sortOrder.BY_VALUE) {
      this.samples.sort((a, b) => (
        a.value == b.value ? 0 :
        a.value < b.value ? -1 : 1
      ));
      this.currentSortOrder = sortOrder.BY_VALUE;
    }
  }

  /**
   * @private
   * @return {shaka.abr.SlidingPercentile.Sample_}
   */
  createSample_() {
    return /** @type {shaka.abr.SlidingPercentile.Sample_} */({});
  }
};

shaka.abr.SlidingPercentile.SortOrder = {
  NONE: -1,
  BY_VALUE: 0,
  BY_INDEX: 1,
};

/**
 * @const {number}
 * @private
 */
shaka.abr.SlidingPercentile.MAX_RECYCLED_SAMPLES = 5;

/**
 * @typedef {{
 *   index: number,
 *   weight: number,
 *   value: number
 * }}
 */
shaka.abr.SlidingPercentile.Sample_;
