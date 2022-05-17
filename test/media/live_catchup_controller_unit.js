goog.require('shaka.media.LiveCatchUpController');

describe('LiveCatchUpController', () => {
  /** @type {!shaka.media.LiveCatchUpController} */
  let controller;

  /** @type {!jasmine.Spy} */
  let getBufferEndSpy;

  /** @type {!jasmine.Spy} */
  let getPlayRateSpy;

  /** @type {!jasmine.Spy} */
  let getPresentationTimeSpy;

  /** @type {!jasmine.Spy} */
  let getPresentationLatencyInfo;

  /** @type {!jasmine.Spy} */
  let trickPlaySpy;

  /** @type {!jasmine.Spy} */
  let getServiceDescriptionSpy;


  beforeEach(() => {
    getBufferEndSpy = jasmine.createSpy('getBufferEnd');
    getPlayRateSpy = jasmine.createSpy('getPlayRate');
    getPresentationTimeSpy = jasmine.createSpy('getPresentationTime');
    trickPlaySpy = jasmine.createSpy('trickPlay');
    getServiceDescriptionSpy = jasmine.createSpy('getServiceDescription');
    getPresentationLatencyInfo = jasmine.createSpy(
        'getPresentationLatencyInfo');

    const playerInterface = {
      getBufferEnd: shaka.test.Util.spyFunc(getBufferEndSpy),
      getPlayRate: shaka.test.Util.spyFunc(getPlayRateSpy),
      getPresentationTime: shaka.test.Util.spyFunc(getPresentationTimeSpy),
      getPresentationLatencyInfo:
        shaka.test.Util.spyFunc(getPresentationLatencyInfo),
      trickPlay: shaka.test.Util.spyFunc(trickPlaySpy),
      getServiceDescription: shaka.test.Util.spyFunc(getServiceDescriptionSpy),
    };

    controller = new shaka.media.LiveCatchUpController(playerInterface);
    controller.configure({
      enabled: false,
      playbackRateMaxOverride: 0,
      playbackRateMinOverride: 0,
      targetLiveLatencyOverride: 5000,
    });
    controller.enable();
  });

  it('does not change play rate when playback rate is 0', () => {
    getPlayRateSpy.and.returnValue(0);
    controller.updatePlayRate();
    expect(trickPlaySpy).not.toHaveBeenCalled();
  });

  it('changes play rate to default max value', () => {
    getPlayRateSpy.and.returnValue(1);
    getBufferEndSpy.and.returnValue(10);
    getPresentationTimeSpy.and.returnValue(5);
    getPresentationLatencyInfo.and.returnValue({
      latency: 10000,
    });
    controller.updatePlayRate();
    expect(trickPlaySpy).toHaveBeenCalledWith(
        controller.getDefaultMaxPlayRate());
  });

  it('changes play rate to ServiceDescription.playbackRate.max', () => {
    const serviceDescription = {
      playbackRate: {
        max: 1.7,
        min: 0.8,
      },
    };
    getPlayRateSpy.and.returnValue(1);
    getBufferEndSpy.and.returnValue(10);
    getPresentationTimeSpy.and.returnValue(5);
    getPresentationLatencyInfo.and.returnValue({
      latency: 10000,
    });
    getServiceDescriptionSpy.and.returnValue(serviceDescription);
    controller.updatePlayRate();
    expect(trickPlaySpy).toHaveBeenCalledWith(
        serviceDescription.playbackRate.max);
  });
});
