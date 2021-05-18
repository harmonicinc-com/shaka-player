goog.provide('shaka.abr.SimpleLLAbrManager');

goog.require('goog.asserts');
goog.require('shaka.abr.SlidingPercentileBandwidthEstimator');
goog.require('shaka.log');
goog.require('shaka.media.SegmentReference');
goog.require('shaka.util.Iterables');
goog.require('shaka.util.StreamUtils');
goog.require('shaka.util.Timer');


/**
 * @summary
 * <p>
 * This defines the default Low Latency ABR manager for the Player
 * </p>
 *
 * @implements {shaka.extern.AbrManager}
 * @export
 */
shaka.abr.SimpleLLAbrManager = class {
  /**
   *
   */
  constructor() {
    /** @private {?shaka.abr.SimpleLLAbrManager.PlayerInterface} */
    this.playerInterface_ = null;

    /** @private {?shaka.extern.AbrManager.SwitchCallback} */
    this.switch_ = null;

    /** @private {boolean} */
    this.enabled_ = false;

    /** @private {shaka.abr.SlidingPercentileBandwidthEstimator} */
    this.bandwidthEstimator_ =
      new shaka.abr.SlidingPercentileBandwidthEstimator();

    // Some browsers implement the Network Information API, which allows
    // retrieving information about a user's network connection. We listen
    // to the change event to be able to make quick changes in case the type
    // of connectivity changes.
    if (navigator.connection) {
      navigator.connection.addEventListener('change', () => {
        if (this.config_.useNetworkInformation) {
          this.bandwidthEstimator_ =
            new shaka.abr.SlidingPercentileBandwidthEstimator();
          const chosenVariant = this.chooseVariant();
          if (chosenVariant) {
            this.switch_(chosenVariant);
          }
        }
      });
    }

    /**
     * A filtered list of Variants to choose from.
     * @private {!Array.<!shaka.extern.Variant>}
     */
    this.variants_ = [];

    /** @private {number} */
    this.playbackRate_ = 1;

    /** @private {boolean} */
    this.startupComplete_ = false;

    /**
     * The last wall-clock time, in milliseconds, when streams were chosen.
     *
     * @private {?number}
     */
    this.lastTimeChosenMs_ = null;

    /** @private {?shaka.extern.AbrConfiguration} */
    this.config_ = null;

    /** @private {number} */
    this.currentBitrate_ = 0;

    /** @private {number} */
    this.stallCount_ = 0;

    /** @private {number} */
    this.resetStallCountDelay_ = 30;

    /** @private {number} */
    this.increaseVideoBitrateDelay_ = 10;

    /** @private {number} */
    this.consecutiveFailedIncreaseVideoBitrateCount_ = 0;

    /** @private {number} */
    this.bufferingTimeToDecreaseBitrate_ = 0.5;

    /** @private {boolean} */
    this.isBuffering_ = false;

    /** @private {boolean} */
    this.isPreviousSwitchIncrease_ = false;

    /** @private {boolean} */
    this.isSwitchIncrease_ = true;

    /** @private {shaka.util.Timer} */
    this.resetStallCountTimer_ = new shaka.util.Timer(() => {
      this.resetStallCount_();
    });

    /** @private {shaka.util.Timer} */
    this.increaseBitrateTimer_ = new shaka.util.Timer(() => {
      this.increaseVideoBitrate_();
    });

    /** @private {shaka.util.Timer} */
    this.decreaseBitrateTimer_ = new shaka.util.Timer(() => {
      this.decreaseVideoBitrate_();
    });

    /** @private {shaka.util.Timer} */
    this.suggestStreamTimer_ = new shaka.util.Timer(() => {
      this.scheduleSuggestStream_();
    });

    this.processedUris = [];
    this.processedUriSet = new Set();
    this.maxProcessedUriCount = 100;

    this.currentVariant = null;
  }


  /**
   * @param {?shaka.abr.SimpleLLAbrManager.PlayerInterface} playerInterface
   */
  setPlayerInterface(playerInterface) {
    this.playerInterface_ = playerInterface;
  }


  /**
   * @override
   * @export
   */
  stop() {
    this.switch_ = null;
    this.enabled_ = false;
    this.variants_ = [];
    this.lastTimeChosenMs_ = null;
    this.playbackRate_ = 1;
  }


  /**
   * @override
   * @export
   */
  init(switchCallback) {
    this.switch_ = switchCallback;
  }


  /**
   * @override
   * @export
   */
  chooseVariant() {
    const AbrManager = shaka.abr.SimpleLLAbrManager;

    // Get sorted Variants.
    let sortedVariants = AbrManager.filterAndSortVariants_(
        this.config_.restrictions, this.variants_);

    if (this.variants_.length && !sortedVariants.length) {
      shaka.log.warning('No variants met the ABR restrictions. ' +
                        'Choosing a variant by lowest bandwidth.');
      sortedVariants = AbrManager.filterAndSortVariants_(
          /* restrictions= */ null, this.variants_);
      sortedVariants = [sortedVariants[0]];
    }

    let chosen = sortedVariants.length > 0 ?
        sortedVariants[sortedVariants.length - 1] : null;
    if (this.bandwidthEstimator_.hasGoodEstimate()) {
      chosen = this.chooseVariantByBandwidth_(sortedVariants);
    } else {
      if (this.lastTimeChosenMs_) {
        if (this.isSwitchIncrease_) {
          chosen = this.chooseNextHigherBandwidthVariant_(sortedVariants);
        } else {
          chosen = this.chooseNextLowerBandwidthVariant_(sortedVariants);
        }
        if (chosen) {
          this.currentBitrate_ = chosen.bandwidth;
          shaka.log.info(this.isSwitchIncrease_ ? 'Increase bandwidth to' :
          'Decrease bandwidth to', chosen.bandwidth);
        }
        this.isPreviousSwitchIncrease_ = this.isSwitchIncrease_;
        this.scheduleIncreaseVideoBitrate_();
      }
    }

    this.lastTimeChosenMs_ = Date.now();
    return chosen;
  }

  /**
   * @param {!Array.<shaka.extern.Variant>} sortedVariants
   * @private
   */
  chooseVariantByBandwidth_(sortedVariants) {
    const defaultBandwidthEstimate = this.getDefaultBandwidth_();
    const currentBandwidth = this.bandwidthEstimator_.getBandwidthEstimate(
        defaultBandwidthEstimate);

    // Start by assuming that we will use the first Stream.
    let chosen = sortedVariants[0] || null;

    const enumerate = (it) => shaka.util.Iterables.enumerate(it);
    for (const {item, next} of enumerate(sortedVariants)) {
      const playbackRate =
          !isNaN(this.playbackRate_) ? Math.abs(this.playbackRate_) : 1;
      const itemBandwidth = playbackRate * item.bandwidth;
      const minBandwidth =
          itemBandwidth / this.config_.bandwidthDowngradeTarget;
      const nextBandwidth =
          playbackRate * (next || {bandwidth: Infinity}).bandwidth;
      const maxBandwidth =
          nextBandwidth / this.config_.bandwidthUpgradeTarget;
      shaka.log.v2('Bandwidth ranges:',
          (itemBandwidth / 1e6).toFixed(3),
          (minBandwidth / 1e6).toFixed(3),
          (maxBandwidth / 1e6).toFixed(3));

      if (currentBandwidth >= minBandwidth &&
          currentBandwidth <= maxBandwidth) {
        chosen = item;
      }
    }
    return chosen;
  }

  /**
   * Find the first variant that greater than current bitrate
   *
   * @param {!Array.<shaka.extern.Variant>} sortedVariants
   * @private
   */
  chooseNextHigherBandwidthVariant_(sortedVariants) {
    let chosen = sortedVariants.length > 0 ?
        sortedVariants[sortedVariants.length - 1] : null;
    for (let i = 0; i < sortedVariants.length; i++) {
      if (this.isPreviousSwitchIncrease_) {
        this.consecutiveFailedIncreaseVideoBitrateCount_ = 0;
      }
      const item = sortedVariants[i];
      if (item.bandwidth > this.currentBitrate_) {
        chosen = item;
        break;
      }
    }
    return chosen;
  }

  /**
   * Find the first variant that smaller than current bitrate
   *
   * @param {!Array.<shaka.extern.Variant>} sortedVariants
   * @private
   */
  chooseNextLowerBandwidthVariant_(sortedVariants) {
    let chosen = sortedVariants.length > 0 ? sortedVariants[0] : null;
    for (let i = sortedVariants.length - 1; i >= 0; i--) {
      if (this.isPreviousSwitchIncrease_) {
        this.consecutiveFailedIncreaseVideoBitrateCount_++;
      } else {
        this.consecutiveFailedIncreaseVideoBitrateCount_ = 0;
      }
      const item = sortedVariants[i];
      if (item.bandwidth < this.currentBitrate_) {
        chosen = item;
        break;
      }
    }
    return chosen;
  }


  /**
   * @override
   * @export
   */
  enable() {
    this.enabled_ = true;
  }


  /**
   * @override
   * @export
   */
  disable() {
    this.enabled_ = false;
  }


  /**
   * @override
   * @export
   */
  segmentDownloaded(deltaTimeMs, numBytes, uri) {
    shaka.log.v2('Segment downloaded:',
        'deltaTimeMs=' + deltaTimeMs,
        'numBytes=' + numBytes,
        'lastTimeChosenMs=' + this.lastTimeChosenMs_,
        'enabled=' + this.enabled_,
        'uri', uri);
    goog.asserts.assert(deltaTimeMs >= 0, 'expected a non-negative duration');

    if (this.processedUriSet.has(uri)) {
      return;
    }

    const isLiveEdgeSegment = this.isLiveEdgeSegment_(uri);
    if (!isLiveEdgeSegment) {
      this.bandwidthEstimator_.sample(deltaTimeMs, numBytes);
      if (this.lastTimeChosenMs_ != null && this.enabled_
        && this.bandwidthEstimator_.hasGoodEstimate()) {
        this.scheduleSuggestStream_();
      }
    }
  }

  /**
   * @override
   * @export
   */
  segmentDownloadCompleted(deltaTimeMs, numBytes, uris) {
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      this.processedUris.push(uri);
      this.processedUriSet.add(uri);
      if (this.processedUris.length > this.maxProcessedUriCount) {
        this.processedUriSet.delete(this.processedUris.shift());
      }
    }
  }


  /**
   * @private
   * @return {boolean}
   */
  isLiveEdgeSegment_(uri) {
    const audioSegmentRef = this.playerInterface_.getLastSegmentRef('audio');
    if (audioSegmentRef && audioSegmentRef.getUris().includes(uri)) {
      return audioSegmentRef.startTime >= this.playerInterface_.getLiveEdge();
    }

    const videoSegmentRef = this.playerInterface_.getLastSegmentRef('video');
    if (videoSegmentRef && videoSegmentRef.getUris().includes(uri)) {
      return videoSegmentRef.startTime >= this.playerInterface_.getLiveEdge();
    }

    return false;
  }


  /**
   * @override
   * @export
   */
  getBandwidthEstimate() {
    return this.bandwidthEstimator_.getBandwidthEstimate(
        this.config_.defaultBandwidthEstimate);
  }


  /**
   * @override
   * @export
   */
  setVariants(variants) {
    this.variants_ = variants;
  }


  /**
   * @override
   * @export
   */
  playbackRateChanged(rate) {
    this.playbackRate_ = rate;
  }


  /**
   * @override
   * @export
   */
  configure(config) {
    this.config_ = config;
  }


  /**
   * Calls switch_() with the variant chosen by chooseVariant().
   *
   * @private
   */
  suggestStreams_() {
    shaka.log.v2('Suggesting Streams...');
    goog.asserts.assert(this.lastTimeChosenMs_ != null,
        'lastTimeChosenMs_ should not be null');

    if (!this.startupComplete_) {
      // Check if we've got enough data yet.
      if (!this.bandwidthEstimator_.hasGoodEstimate()) {
        shaka.log.v2('Still waiting for a good estimate...');
        return;
      }
      this.startupComplete_ = true;
    } else {
      // Check if we've left the switch interval.
      const now = Date.now();
      const delta = now - this.lastTimeChosenMs_;
      if (delta < this.config_.switchInterval * 1000) {
        shaka.log.v2('Still within switch interval...');
        return;
      }
    }

    const chosenVariant = this.chooseVariant();
    const defaultBandwidthEstimate = this.getDefaultBandwidth_();
    const bandwidthEstimate = this.bandwidthEstimator_.getBandwidthEstimate(
        defaultBandwidthEstimate);
    const currentBandwidthKbps = Math.round(bandwidthEstimate / 1000.0);

    if (chosenVariant && chosenVariant != this.currentVariant) {
      shaka.log.debug(
          'Calling switch_(), bandwidth=' + currentBandwidthKbps + ' kbps');
      // If any of these chosen streams are already chosen, Player will filter
      // them out before passing the choices on to StreamingEngine.
      this.switch_(chosenVariant);
      this.currentVariant = chosenVariant;
    }
  }


  /**
   * @private
   */
  getDefaultBandwidth_() {
    let defaultBandwidthEstimate = this.config_.defaultBandwidthEstimate;
    if (navigator.connection && navigator.connection.downlink &&
        this.config_.useNetworkInformation) {
      defaultBandwidthEstimate = navigator.connection.downlink * 1e6;
    }
    return defaultBandwidthEstimate;
  }


  /**
   * @override
   * @export
   */
  onBuffering() {
    if (this.bandwidthEstimator_.hasGoodEstimate()) {
      return;
    }

    this.isBuffering_ = true;
    this.stallCount_++;
    this.scheduleResetStallCount_();
    this.scheduleIncreaseVideoBitrate_();
    this.decreaseBitrateTimer_.tickAfter(this.bufferingTimeToDecreaseBitrate_);

    if (this.stallCount_ >= this.config_.stallCountToDowngrade) {
      this.decreaseVideoBitrate_();
    }
  }

  /**
   * @override
   * @export
   */
  onBufferingEnd() {
    this.isBuffering_ = false;
    this.decreaseBitrateTimer_.stop();
  }


  /**
   * @private
   */
  resetStallCount_() {
    this.stallCount_ = 0;
  }


  /**
   * @private
   */
  scheduleResetStallCount_() {
    this.resetStallCountTimer_.stop();
    this.resetStallCountTimer_.tickAfter(this.resetStallCountDelay_);
  }


  /**
   * @private
   */
  scheduleIncreaseVideoBitrate_() {
    this.increaseBitrateTimer_.stop();
    this.increaseBitrateTimer_.tickAfter(this.increaseVideoBitrateDelay_ <<
      this.consecutiveFailedIncreaseVideoBitrateCount_);
  }

  /**
   * @private
   */
  scheduleSuggestStream_() {
    if (this.isBuffering_) {
      this.suggestStreamTimer_.stop();
      this.suggestStreamTimer_.tickAfter(0.1);
      return;
    }
    this.suggestStreams_();
  }


  /**
   * @private
   */
  increaseVideoBitrate_() {
    this.isSwitchIncrease_ = true;
    if (this.enabled_) {
      const serviceDescription = this.playerInterface_.getServiceDescription();
      const presentationLatency =
          this.playerInterface_.getPresentationLatency();
      let latency = 0;
      if (serviceDescription && presentationLatency.length > 0 &&
        presentationLatency[0]['latency']) {
        latency = presentationLatency[0]['latency'];
      }
      if (latency > serviceDescription.latency.max) {
        this.scheduleIncreaseVideoBitrate_();
      } else {
        this.scheduleSuggestStream_();
      }
    }
  }


  /**
   * @private
   */
  decreaseVideoBitrate_() {
    this.isSwitchIncrease_ = false;
    if (this.enabled_) {
      this.scheduleSuggestStream_();
    }
    this.resetStallCount_();
  }


  /**
   * @return {number}
   */
  getIncreaseVideoBitrateDelay() {
    return this.increaseVideoBitrateDelay_;
  }


  /**
   * @param {?shaka.extern.Restrictions} restrictions
   * @param {!Array.<shaka.extern.Variant>} variants
   * @return {!Array.<shaka.extern.Variant>} variants filtered according to
   *   |restrictions| and sorted in ascending order of bandwidth.
   * @private
   */
  static filterAndSortVariants_(restrictions, variants) {
    if (restrictions) {
      variants = variants.filter((variant) => {
        // This was already checked in another scope, but the compiler doesn't
        // seem to understand that.
        goog.asserts.assert(restrictions, 'Restrictions should exist!');

        return shaka.util.StreamUtils.meetsRestrictions(
            variant, restrictions,
            /* maxHwRes= */ {width: Infinity, height: Infinity});
      });
    }

    return variants.sort((v1, v2) => {
      return v1.bandwidth - v2.bandwidth;
    });
  }
};

/**
 * @typedef {{
 *   getBufferLevel: function():number,
 *   getPresentationLatency: function():Array<Object>,
 *   getServiceDescription:
 *   (function():shaka.extern.ServiceDescription|undefined),
 *   getLastSegmentRef:
 *   function(string):shaka.media.SegmentReference,
 *   getLiveEdge: function():number
 * }}
 *
 * @property {function():number} getBufferLevel
 *   Get the buffer level in seconds
 * @property {function():Array<Object>} getPresentationLatency
 *   Get the presentation latency
 * @export
 */
shaka.abr.SimpleLLAbrManager.PlayerInterface;
