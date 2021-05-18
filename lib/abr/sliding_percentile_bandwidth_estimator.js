goog.provide('shaka.abr.SlidingPercentileBandwidthEstimator');

goog.require('shaka.abr.SlidingPercentile');

/**
 * @summary
 * This class tracks bandwidth samples and estimates available bandwidth.
 * Based on the minimum of two exponentially-weighted moving averages with
 * different half-lives.
 *
 */
shaka.abr.SlidingPercentileBandwidthEstimator = class {
  /** */
  constructor() {
    /**
     * @private {!shaka.abr.SlidingPercentile}
     */
    this.slidingPercentile_ = new shaka.abr.SlidingPercentile(
        shaka.abr.SlidingPercentileBandwidthEstimator
            .DEFAULT_SLIDING_WINDOW_MAX_WEIGHT,
    );

    /**
     * Number of bytes sampled.
     * @private {number}
     */
    this.totalTimeElapsed_ = 0;

    /**
     * Number of bytes sampled.
     * @private {number}
     */
    this.totalBytesTransferred_ = 0;

    /**
     * * @private {number}
     */
    this.bandwidthEstimate_ = 0;
  }

  /**
   * Takes a bandwidth sample.
   *
   * @param {number} durationMs The amount of time, in milliseconds, for a
   *   particular request.
   * @param {number} numBytes The total number of bytes transferred in that
   *   request.
   */
  sample(durationMs, numBytes) {
    this.totalTimeElapsed_ += durationMs;
    this.totalBytesTransferred_ += numBytes;
    if (durationMs > 0) {
      const bitsPerSecond = 8000 * numBytes / durationMs;
      this.slidingPercentile_.addSample(Math.sqrt(numBytes), bitsPerSecond);
      if (this.hasGoodEstimate()) {
        this.bandwidthEstimate_ = this.slidingPercentile_.getPercentile(0.5);
      }
    }
  }


  /**
   * Gets the current bandwidth estimate.
   *
   * @param {number} defaultEstimate
   * @return {number} The bandwidth estimate in bits per second.
   */
  getBandwidthEstimate(defaultEstimate) {
    if (!this.hasGoodEstimate()) {
      return defaultEstimate;
    }
    return this.bandwidthEstimate_;
  }


  /**
   * @return {boolean} True if there is enough data to produce a meaningful
   *   estimate.
   */
  hasGoodEstimate() {
    const Estimator = shaka.abr.SlidingPercentileBandwidthEstimator;
    return this.totalTimeElapsed_ >= Estimator.ELAPSED_MILLIS_FOR_ESTIMATE ||
        this.totalBytesTransferred_ >= Estimator.BYTES_TRANSFERRED_FOR_ESTIMATE;
  }
};

/**
 * @const {number}
 * @private
 */
shaka.abr.SlidingPercentileBandwidthEstimator.ELAPSED_MILLIS_FOR_ESTIMATE
  = 2000;

/**
 * @const {number}
 * @private
 */
shaka.abr.SlidingPercentileBandwidthEstimator.BYTES_TRANSFERRED_FOR_ESTIMATE
  = 512 * 1024;

/**
 * @const {number}
 * @private
 */
shaka.abr.SlidingPercentileBandwidthEstimator.DEFAULT_SLIDING_WINDOW_MAX_WEIGHT
  = 2000;
