import { AppService } from './app.service';
import { CLOCK_CENTER } from './clock';
import $ from 'jquery';
import { DateTime, Timezone } from '@tubular/time';
import { abs, cos_deg, floor, max, min, mod2, round, sign, sin_deg } from '@tubular/math';
import {
  blendColors, clone, doesCharacterGlyphExist, getTextWidth, htmlEscape, isChrome, isChromium, isEdge, isEqual, isObject, last,
  processMillis, push, regex, toNumber
} from '@tubular/util';
import {
  AirQualitySource, AirQualityValues, Alert, CurrentConditions, DailyConditions, ForecastData, HourlyConditions
} from '../server/src/shared-types';
import { reflow } from './svg-flow';
import {
  ClickishEvent, compassPoint, convertPressure, convertSpeed, convertTemp, describeArc, displayHtml, formatHour, fToC, getDayClasses,
  getJson, JsonOptions, kphToKnots, localDateString, localShortDate, localShortDateTime, localShortTime, mphToKnots, setSvgHref,
  stopPropagation
} from './awc-util';
import { windBarbsSvg } from './wind-barbs';
import { CurrentTemperatureHumidity, HourlyForecast, TimeFormat } from './shared-types';
import { AlertFilterType, demoServer } from './settings';

interface SVGAnimationElementPlus extends SVGAnimationElement {
  beginElement: () => void;
}

interface DisplayedAlert {
  acknowledged?: boolean;
  alert?: Alert;
  altText?: string;
  asError?: boolean;
  asNotification?: boolean;
}

const DEFAULT_BACKGROUND = 'inherit';
const DEFAULT_FOREGROUND = 'white';
const ERROR_BACKGROUND = '#CCC';
const ERROR_FOREGROUND = 'black';
const ADVISORY_BACKGROUND = 'cyan';
const ADVISORY_FOREGROUND = 'black';
const WATCH_BACKGROUND = 'orange';
const WATCH_FOREGROUND = 'black';
const WARNING_BACKGROUND = 'red';
const WARNING_FOREGROUND = 'white';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SIXTEEN_BY_NINE = 1.77; // Just a little under for rounding
const CLOCK_ICON_RADIUS = 38;
const CLOCK_ICON_INNER_RADIUS = 31;
const CLOCK_TEMPS_RADIUS = 34.5;
const CLOCK_TEMPS_INNER_RADIUS = 27;
// There's a Chrome glitch where some SVG icons are getting clipped at the edges. For some strange
// reason using a transform to scale these icons down, then larger unit sizes to scale them back up
// again, fixes the problem.
const SCALING_FIX = (isChrome() || isChromium() ? 0.875 : 1);
const HOURLY_ICON_SIZE = 3.5 / SCALING_FIX;
const HOURLY_VERT_OFFSET = 2.5;
const HOURLY_LEFT_COLUMN = 0.5;
const HOURLY_RIGHT_COLUMN = 99.5;
const HOURLY_TEMP_VERT_OFFSET = 3.5;
const HOURLY_VERT_SPACING = 6.7;
const FORECAST_DAY_WIDTH = 13;
const BULLET_SPACER = ' \u2022 ';
const PCT = '<tspan class="small-percent" dy="-0.2em 0.2em">%\u200B</tspan>';
const BULLET_REGEX = new RegExp(BULLET_SPACER, 'g');
const MARQUEE_JOINER = '\u00A0\u00A0\u00A0\u25C8\u00A0\u00A0\u00A0'; // '   ◈   ', non-breaking spaces with bordered diamond
const START_ERROR_TAG = `<span style="color: ${ERROR_FOREGROUND}; background-color: ${ERROR_BACKGROUND};">&nbsp;`;
const CLOSE_ERROR_TAG = '&nbsp;</span>';
const REVERT_TO_SUN_INFO_DELAY = 60_000;
let SUBJECT_INTRO_PATTERN: RegExp;

const airQualityColors = ['#00E400', '#FFFF00', '#ff7E00', '#FF0000',
                          '#8F3F97', '#8F3F97', '#7E0023', '#7E0023', '#7E0023', '#7E0023'];
const euAirQualityColors = ['#6ED958', '#D7F400', '#FFD200', '#FFAD00', '#FF0066'];
const airQualityCaptions = ['GOOD', 'MODERATE', 'UNHEALTHY\nFOR SENS. GROUPS', 'UNHEALTHY',
                            'VERY\nUNHEALTHY', 'VERY\nUNHEALTHY', 'HAZARDOUS', 'HAZARDOUS', 'HAZARDOUS', 'HAZARDOUS'];
const euAirQualityCaptions = ['VERY LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY HIGH'];

function matchingTextColor(color: string): string {
  const [r, g, b] = color.split('') // Break into individual characters
    .map((c, i, a) => i % 2 ? c + a[i + 1] : '') // Create pairs and empty strings
    .filter(p => !!p) // Filter out empty string
    .map(p => parseInt(p, 16));
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 128 ? 'black' : 'white';
}

try {
  // Firefox fails on this pattern.
  // eslint-disable-next-line prefer-regex-literals
  SUBJECT_INTRO_PATTERN = regex`^((• )?\p{Lu}{4,}[ \p{Lu}]*)\.\.\.(?!\.)${'gmu'}`;
}
catch {
  SUBJECT_INTRO_PATTERN = /^((• )?[A-Z]{4,}[ A-Z]*)\.\.\.(?!\.)/gmu;
}

const MARQUEE_SPEED = 100; // pixels per second

const FREQUENT_THRESHOLD = 300;

const MAX_FORECAST_STALENESS = 7200000; // 2 hours
const MAX_CURRENT_TEMP_STALENESS = 1800000; // 30 minutes

const EMPTY_ICON = 'assets/empty.svg';
const UNKNOWN_ICON = 'assets/unknown.svg';
const NO_DATA: CurrentTemperatureHumidity = { forecastFeelsLike: null, forecastHumidity: null, forecastStale: null, forecastTemp: null };

const REVERT_TO_START_OF_WEEK_DELAY = 60_000; // 1 minute

function eventInside(event: MouseEvent | Touch, elem: HTMLElement): boolean {
  const rect = elem.getBoundingClientRect();
  const x = event.pageX;
  const y = event.pageY;

  return rect.x <= x && x <= rect.right && rect.y <= y && y <= rect.bottom;
}

function concatenateAlerts(alerts: Alert[] | DisplayedAlert[], forDialog = false, dropped = false): string {
  return (alerts ?? []).map((a : Alert & DisplayedAlert) => {
    if (a.acknowledged && !forDialog)
      return null;

    const alert: Alert = a.alert ?? (a.title ? a : null);
    const dialogAlert = alert?.id && forDialog;
    let text: string;

    if (alert && !a.altText) {
      const collapsed = (dropped ? ' collapsed' : '');

      text = (dialogAlert ? `<div class="alert-wrapper${collapsed}" id="X${alert.id}_aw">` +
          (dropped ?
            '<div class="alert-filtered"><img src="assets/chevron-right.svg" alt="chevron-right"><span>filtered</span></div>' :
            `<div class="alert-toggle" id="X${alert.id}_at">` +
            `<input type="checkbox" id="X${alert.id}_cb"><label for="X${alert.id}_cb">Acknowledge</label></div>`) +
          '<div class="alert-inner-wrapper"><!-- start -->'
        : '') +
        htmlEscape(`${alert.title}: ${alert.description}`.replace(/\r\n|\r/g, '\n').trim())
          .replace(/\s[\s\x23-\x2F\x3A-\x40]+$/, '') // Remove seemingly random trailing characters from alerts.
          .replace(/^\* /gm, '• ') // Replace asterisks used as bullets with real bullets.
          .replace(SUBJECT_INTRO_PATTERN, '$1: '); // Improve alert formatting.

      if (dialogAlert) {
        text += '</div></div>';
        text = text.replace(/<!-- start -->(.+?)\n\n/s,
          '<div class="alert-first-line-shortened">$1</div><div class="alert-first-line">$1</div>\n');
      }
    }
    else
      text = htmlEscape(a.altText || '');

    if (a?.asError || a?.asNotification)
      text = START_ERROR_TAG + text + CLOSE_ERROR_TAG;

    return text;
  }).filter(t => t != null).join(BULLET_SPACER);
}

function droppedAlertSymbols(alerts: Alert[]): string {
  return (alerts ?? []).map(a => ({
    advisory: '<div class="bead" style="background-color: blue">&nbsp;</div>',   // 🔵
    watch:    '<div class="bead" style="background-color: orange">&nbsp;</div>', // 🟠
    warning:  '<div class="bead" style="background-color: red">&nbsp;</div>'     // 🔴
  })[a.severity] || '').join('');
}

function acknowledgedAlertSymbols(alerts: Alert[]): string {
  return (alerts ?? []).map(a => ({
    advisory: '<div class="check-icon" style="background-color: blue"><span>✓</span></div>',
    watch:    '<div class="check-icon" style="background-color: orange"><span>✓</span></div>',
    warning:  '<div class="check-icon" style="background-color: red"><span>✓</span></div>'
  })[a.severity] || '').join('');
}

function convertForWidthMeasurement(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/[ \n\r\t]+/g, ' ');
}

export class Forecast {
  private readonly currentIcon: JQuery;
  private readonly dayBackgrounds: HTMLElement[] = [];
  private readonly dayHeaders: HTMLElement[] = [];
  private readonly marqueeOuterWrapper: JQuery;
  private readonly marqueeWrapper: JQuery;
  private readonly marquee: JQuery;
  private readonly settingsBtn: JQuery;
  private readonly visualXLogo: JQuery;
  private readonly weatherbitLogo: JQuery;
  private readonly wundergroundLogo: JQuery;
  private readonly windPointer: JQuery;

  private airQuality: JQuery;
  private airQualityCaption: JQuery;
  private airQualityCaption1: JQuery;
  private airQualityCaption2: JQuery;
  private airQualityColor: JQuery;
  private airQualityColor2: JQuery;
  private airQualityText: JQuery;
  private airQualityValue: JQuery;
  private dailyWinds: JQuery[] = [];
  private dayIcons: JQuery[] = [];
  private dayLowHighs: JQuery[] = [];
  private dayChancePrecips: JQuery[] = [];
  private dayPrecipAccums: JQuery[] = [];
  private hourIcons: SVGImageElement[] = [];
  private hourWinds: SVGSVGElement[] = [];
  private hourTemps: SVGTextElement[] = [];
  private hourPops: SVGTextElement[] = [];
  private forecastMarkers: JQuery;
  private wind: JQuery;
  private windArc: JQuery;
  private windGustArc: JQuery;
  private pressure: JQuery;

  private readonly weatherServer: string;

  private _hourlyForecast = HourlyForecast.CIRCULAR;
  private lastForecastData: ForecastData;
  private todayIndex = 0;
  private cachedHourly: HourlyConditions[] = [];
  private lastForecastTime = 0;
  private timezone = Timezone.OS_ZONE;
  private showingStartOfWeek = true;
  private showingHourTemps = true;
  private hourInfoTimer: any;
  private forecastDaysVisible = 4;
  private _hasGoodData = false;

  private marqueeDialogText = '';
  private marqueeBackground = DEFAULT_BACKGROUND;
  private currentAlerts: { alerts?: DisplayedAlert[], droppedAlerts?: Alert[] };
  private animationStart: number;
  private animationWidth: number;
  private animationRequestId = 0;
  private rainGlyph: string;
  private snowGlyph: string;

  constructor(private appService: AppService) {
    this.currentIcon = $('#current-icon');

    for (let i = 0; i < 7; ++i) {
      this.dailyWinds[i] = $('#day' + i + '-wind');
      this.dayIcons[i] = $('#day' + i + '-icon');
      this.dayLowHighs[i] = $('#day' + i + '-low-high');
      this.dayChancePrecips[i] = $('#day' + i + '-chance-precip');
      this.dayPrecipAccums[i] = $('#day' + i + '-precip-accum');
    }

    this.visualXLogo = $('#visual-x-logo');
    this.settingsBtn = $('#settings-btn');
    this.weatherbitLogo = $('#weatherbit-logo');
    this.wundergroundLogo = $('#wunderground-logo');

    this.marqueeOuterWrapper = $('#marquee-outer-wrapper');
    this.marqueeWrapper = $('#marquee-wrapper');
    this.marquee = $('#marquee');
    this.marqueeBackground = $('body').css('--background-color');
    this.forecastMarkers = $('#hourly-forecast-start, #hourly-forecast-end');
    this.wind = $('#wind');
    this.windPointer = $('#wind-pointer');
    this.windArc = $('#wind-arc');
    this.windGustArc = $('#wind-gust-arc');
    this.pressure = $('#pressure');
    this.airQuality = $('#air-quality');
    this.airQualityCaption = $('#air-quality-caption');
    this.airQualityCaption1 = $('#air-quality-caption-1');
    this.airQualityCaption2 = $('#air-quality-caption-2');
    this.airQualityColor = $('#air-quality-color');
    this.airQualityColor2 = $('#air-quality-color-2');
    this.airQualityText = $('#air-quality-text');
    this.airQualityValue = $('#air-quality-value');

    this.dayHeaders = getDayClasses('forecast-day-header');
    this.dayBackgrounds = getDayClasses('forecast-day-background');
    this.marqueeWrapper.on('click', () => this.showMarqueeDialog());

    if (!isEdge())
      this.weatherServer = appService.getApiServer();
    else
      this.weatherServer = '';

    this.checkAspectRatio();
    this.decorateClockFace();
    this.detectGestures();

    window.addEventListener('resize', () => {
      this.checkAspectRatio();
      this.updateMarqueeAnimation(null);
    });
  }

  get hasGoodData(): boolean { return this._hasGoodData; }

  private detectGestures(): void {
    const forecastRect = $('#forecast-rect')[0];
    const width = forecastRect.getBoundingClientRect().width;

    const dragStartThreshold = 3;
    const swipeThreshold = width * 1.5 / 7; // Distance across 1.5 viewable days
    const animateToStart = (document.getElementById('start-of-week') as unknown as SVGAnimationElementPlus);
    const animateToEnd = (document.getElementById('end-of-week') as unknown as SVGAnimationElementPlus);
    const animateWeekDrag = (document.getElementById('drag-week') as unknown as SVGAnimationElementPlus);
    const skipToStart = document.getElementById('week-backward');
    const disabledSkipColor = skipToStart.getAttribute('fill');
    const skipToEnd = document.getElementById('week-forward');
    const enabledSkipColor = skipToEnd.getAttribute('fill');
    let dragging = false;
    let dragAnimating = false;
    let dragEndTime = 0;
    let downX: number;
    let lastX: number;
    let maxMove = 0;
    let revertToStart: any;
    let swipeAnimating = false;
    let lastAnimX = 0;

    animateWeekDrag.addEventListener('beginEvent', () => dragAnimating = true);
    animateToStart.addEventListener('beginEvent', () => swipeAnimating = true);
    animateToEnd.addEventListener('beginEvent', () => swipeAnimating = true);

    animateWeekDrag.addEventListener('endEvent', () => dragAnimating = false);
    animateToStart.addEventListener('endEvent', () => {
      swipeAnimating = false;
      lastAnimX = 0;
    });
    animateToEnd.addEventListener('endEvent', () => {
      swipeAnimating = false;
      lastAnimX = FORECAST_DAY_WIDTH * (this.forecastDaysVisible - 7);
    });

    $('#sunrise-set').on('click', () => this.appService.toggleSunMoon());
    $('#moonrise-set').on('click', () => this.appService.toggleSunMoon());
    $('#sun-moon-clicker').on('click', () => this.appService.toggleSunMoon());
    $('.hour-temps, .hour-pops, .hour-icon, .hour-wind').on('click', (evt) => stopPropagation(evt, () => this.toggleHourInfo()));

    const self = this;

    for (let s = 0; s < 7; ++s) {
      $(`#day${s}-clicker`).on('click', function () {
        if (processMillis() < dragEndTime + 500 || dragAnimating || swipeAnimating)
          return;

        const index = toNumber(this.id.replace(/\D/g, ''));

        self.showDayForecast(index);
      });
    }

    this.airQualityColor.on('click', () => this.showAirQualityDetails());
    this.airQualityColor2.on('click', () => this.showAirQualityDetails());

    let usingTouch = false;
    let maxInc = 4;
    let downTime = Number.MIN_SAFE_INTEGER;
    let sunMoonClick = false;
    let isForecastRect = false;
    const mouseDown = (x: number, evt?: ClickishEvent | TouchEvent): void => {
      isForecastRect = (evt?.target?.id === 'forecast-rect');

      if (!isForecastRect && evt && !(evt.target.id || '').match(/^(sun|day).+-clicker$/))
        return;

      dragging = true;
      lastX = downX = x;
      maxMove = 0;
      maxInc = 4;
      downTime = processMillis();
      sunMoonClick = (evt?.target.id === 'sun-moon-clicker');

      if (isForecastRect && 'pageY' in evt) {
        const r = evt.target.getBoundingClientRect();
        const y = ((evt as any).pageY - r.top) / r.height;

        if (y > 0.5)
          sunMoonClick = true;
      }
    };
    window.addEventListener('mousedown', evt => eventInside(evt, forecastRect) ? usingTouch || mouseDown(evt.pageX, evt) : null);
    window.addEventListener('touchstart', evt => evt.touches.length > 0 && eventInside(evt.touches[0], forecastRect) ?
      (usingTouch = true) && mouseDown(evt.touches[0].pageX, evt) : null
    );

    const doSwipe = (dx: number): void => {
      if (revertToStart) {
        clearTimeout(revertToStart);
        revertToStart = undefined;
      }

      if (swipeAnimating)
        return;
      else if (dragAnimating) {
        setTimeout(() => doSwipe(dx), 1);
        return;
      }

      if (dx < 0) {
        this.showingStartOfWeek = false;
        skipToEnd.setAttribute('fill', disabledSkipColor);
        skipToStart.setAttribute('fill', enabledSkipColor);
        $(animateToEnd).attr('from', `${lastAnimX} 0`);
        setTimeout(() => animateToEnd.beginElement());

        revertToStart = setTimeout(() => {
          revertToStart = undefined;
          doSwipe(1);
        }, REVERT_TO_START_OF_WEEK_DELAY);
      }
      else {
        this.showingStartOfWeek = true;
        skipToStart.setAttribute('fill', disabledSkipColor);
        skipToEnd.setAttribute('fill', enabledSkipColor);
        $(animateToStart).attr('from', `${lastAnimX} 0`);
        setTimeout(() => animateToStart.beginElement());
      }
    };

    const restorePosition = (): void => {
      if (dragAnimating) {
        setTimeout(() => restorePosition(), 1);
        return;
      }

      if (this.showingStartOfWeek) {
        $(animateToStart).attr('from', `${lastAnimX} 0`);
        animateToStart.beginElement();
      }
      else {
        $(animateToEnd).attr('from', `${lastAnimX} 0`);
        animateToEnd.beginElement();
      }
    };

    $('#week-forward, #week-forward-bkg').on('click', () => {
      if (this.showingStartOfWeek)
        doSwipe(-1);
    });

    $('#week-backward, #week-backward-bkg').on('click', () => {
      if (!this.showingStartOfWeek)
        doSwipe(1);
    });

    let smoother: any;

    const mouseMove = (x = lastX, smoothTarget?: number): void => {
      if (!dragging || x === lastX)
        return;

      const dx = x - lastX;

      if (smoothTarget || abs(dx) > maxInc) {
        if (smoothTarget == null) {
          smoothTarget = x;
          x = lastX + sign(x - lastX) * min(abs(x - lastX), maxInc);

          if (smoother)
            clearTimeout(smoother);
        }

        const dx = smoothTarget - x;

        smoother = setTimeout(() => {
          const nextX = lastX + sign(dx) * min(abs(dx), maxInc);
          smoother = undefined;
          mouseMove(nextX, smoothTarget === nextX ? undefined : smoothTarget);
        }, 10);
      }
      else if (smoother) {
        clearTimeout(smoother);
        smoother = undefined;
      }

      const deltaStart = x - downX;

      maxMove = max(abs(deltaStart), abs(maxMove));
      lastX = x;

      if (maxMove >= dragStartThreshold && !dragAnimating && !swipeAnimating) {
        const shift = FORECAST_DAY_WIDTH * (this.forecastDaysVisible - 7);
        const currentShift = this.showingStartOfWeek ? 0 : shift;
        const dragTo = currentShift + deltaStart / width * 91;
        const dragToClamped = min(max(dragTo, shift - FORECAST_DAY_WIDTH / 4), FORECAST_DAY_WIDTH / 4);

        $(animateWeekDrag).attr('from', `${lastAnimX} 0`);
        $(animateWeekDrag).attr('to', `${dragToClamped} 0`);
        lastAnimX = dragTo;
        animateWeekDrag.beginElement();
        downX += (dragTo - dragToClamped) * width / 91;
      }
    };
    window.addEventListener('mousemove', event => mouseMove(event.pageX));
    window.addEventListener('touchmove', event => mouseMove(event.touches[0]?.pageX ?? lastX));

    const mouseUp = (x: number): void => {
      if (!dragging)
        return;
      else if (smoother) {
        maxInc = 12;
        setTimeout(() => mouseUp(x), 10);
        return;
      }

      dragging = false;
      lastX = undefined;
      usingTouch = false;

      if (maxMove >= 0) {
        const goodClick = (maxMove < dragStartThreshold && processMillis() < downTime + 500);

        if (goodClick && sunMoonClick && isForecastRect)
          this.appService.toggleSunMoon();
        else if (goodClick && !sunMoonClick) {
          const dayClickers = Array.from(document.querySelectorAll('[id$="-clicker"]'))
            .filter(elem => /^day\d-clicker$/.test(elem.id)) as HTMLElement[];

          for (const clicker of dayClickers) {
            const r = clicker.getBoundingClientRect();

            if ((r.left <= x && x <= r.right)) {
              if (clicker.click) // No click() method on Firefox SVG <rect>
                clicker.click();
              else if (clicker.dispatchEvent)
                clicker.dispatchEvent(new Event('click'));

              break;
            }
          }

          restorePosition();
        }
        else {
          const dx = (x ?? downX) - downX;

          if (abs(dx) >= swipeThreshold)
            doSwipe(dx);
          else
            restorePosition();

          if (maxMove >= dragStartThreshold)
            dragEndTime = processMillis();
        }
      }
      else
        restorePosition();
    };

    window.addEventListener('mouseup', event => mouseUp(event.pageX));
    window.addEventListener('touchend', event => mouseUp(event.touches[0]?.pageX ?? lastX));
    window.addEventListener('touchcancel', () => mouseUp(null));
  }

  private decorateClockFace(): void {
    const clock = document.getElementById('clock');
    const halfIcon = HOURLY_ICON_SIZE / 2;

    for (let i = 0; i < 24; ++i) {
      const isNew = !this.hourIcons[i];
      const vertical = this.hourlyForecast === HourlyForecast.VERTICAL;
      const deg = i * 30 + 15;
      const hourIcon = isNew ? document.createElementNS(SVG_NAMESPACE, 'image') : this.hourIcons[i];
      const hourWind = isNew ? document.createElementNS(SVG_NAMESPACE, 'svg') : this.hourWinds[i];
      const hourTemp = isNew ? document.createElementNS(SVG_NAMESPACE, 'text') : this.hourTemps[i];
      const hourPop = isNew ? document.createElementNS(SVG_NAMESPACE, 'text') : this.hourPops[i];
      let r: number;
      let x: number;
      let y: number;

      if (vertical) {
        x = i < 12 ? HOURLY_LEFT_COLUMN : HOURLY_RIGHT_COLUMN;
        y = (i % 12 - 6) * HOURLY_VERT_SPACING + CLOCK_CENTER + HOURLY_VERT_OFFSET;
      }
      else {
        r = (i < 12 ? CLOCK_ICON_RADIUS : CLOCK_ICON_INNER_RADIUS);
        x = CLOCK_CENTER + r * cos_deg(deg - 90);
        y = CLOCK_CENTER + r * sin_deg(deg - 90);
      }

      const setVerticalOrCircular = (elem: SVGElement): void => {
        elem.classList.add(vertical ? 'vertical' : 'circular');
        elem.classList.remove(vertical ? 'circular' : 'vertical');
      };

      hourIcon.setAttribute('x', ((x - halfIcon) / SCALING_FIX).toString());
      hourIcon.setAttribute('y', ((y - halfIcon) / SCALING_FIX).toString());
      hourIcon.setAttribute('height', HOURLY_ICON_SIZE.toString());
      hourIcon.setAttribute('width', HOURLY_ICON_SIZE.toString());
      hourIcon.classList.add('hour-icon', 'hour-info-show');
      setVerticalOrCircular(hourIcon);

      if (SCALING_FIX !== 1)
        hourIcon.setAttribute('transform', `scale(${SCALING_FIX})`);

      if (isNew)
        hourIcon.setAttribute('href', EMPTY_ICON);

      hourWind.setAttribute('x', (x - halfIcon).toString());
      hourWind.setAttribute('y', (y - halfIcon).toString());
      hourWind.setAttribute('height', HOURLY_ICON_SIZE.toString());
      hourWind.setAttribute('width', HOURLY_ICON_SIZE.toString());
      hourWind.setAttribute('viewBox', ' 0 0 100 100');
      hourWind.classList.add('hour-wind', 'wind-barb', 'hour-info-hide');
      setVerticalOrCircular(hourWind);

      [hourTemp, hourPop].forEach((text, j) => {
        let y2 = y;

        if (vertical) {
          y2 += HOURLY_TEMP_VERT_OFFSET;
          text.removeAttribute('dy');
          text.setAttribute('dx', (i < 12 ? -halfIcon : halfIcon).toString());
          text.style.textAnchor = (i < 12 ? 'start' : 'end');
        }
        else {
          r = (i < 12 ? CLOCK_TEMPS_RADIUS : CLOCK_TEMPS_INNER_RADIUS);
          x = CLOCK_CENTER + r * cos_deg(deg - 90);
          y2 = CLOCK_CENTER + r * sin_deg(deg - 90);
          text.removeAttribute('dx');
          text.setAttribute('dy', '0.5em');
          text.style.textAnchor = 'middle';
        }

        text.setAttribute('x', x.toString());
        text.setAttribute('y', y2.toString());
        text.classList.add(j === 0 ? 'hour-temps' : 'hour-pops');
        text.classList.add(j === 0 ? 'hour-info-show' : 'hour-info-hide');
        setVerticalOrCircular(text);
      });

      if (isNew) {
        hourTemp.innerHTML = '';
        clock.appendChild(hourIcon);
        this.hourIcons[i] = hourIcon;
        clock.appendChild(hourWind);
        this.hourWinds[i] = hourWind;
        clock.appendChild(hourTemp);
        this.hourTemps[i] = hourTemp;
        clock.appendChild(hourPop);
        this.hourPops[i] = hourPop;
      }
      else
        hourTemp.innerHTML = hourTemp.innerHTML.replace(/.*?(\b\d+°).*/, '$1');
    }
  }

  update(latitude: number, longitude: number, isMetric: boolean, knots: boolean, userId?: string): void {
    this.getForecast(latitude, longitude, isMetric, knots, userId).then((forecastData: ForecastData) => {
      this._hasGoodData = true;
      this.updateHourlyCache(forecastData);
      this.lastForecastData = forecastData;
      this.lastForecastTime = performance.now();
      this.appService.updateCurrentTemp({ forecastStale: false });
      this.displayForecast(forecastData);

      const vc = (forecastData.source === 'visual_x');
      const wb = (forecastData.source === 'weatherbit');
      const wu = (forecastData.source === 'wunderground');
      const buttonWidth = this.settingsBtn.width();
      const logoWidth = (vc ? 212 : (wb || wu ? 183 : 8)) + 20;

      this.visualXLogo.css('display', vc ? 'flex' : 'none');
      this.weatherbitLogo.css('display', wb ? 'flex' : 'none');
      this.wundergroundLogo.css('display', wu ? 'flex' : 'none');
      this.marqueeOuterWrapper.css('right', (buttonWidth + logoWidth) + 'px');
      this.settingsBtn.css('margin-right', vc || wu || wb ? 0 : 8);

      this.appService.forecastHasBeenUpdated(
        isMetric ? forecastData.currently.temperature : fToC(forecastData.currently.temperature),
        forecastData.currently.humidity * 100);
    }).catch(error => {
      this._hasGoodData = false;

      const now = performance.now();

      if (!this.lastForecastData || now >= this.lastForecastTime + MAX_FORECAST_STALENESS) {
        this.appService.updateCurrentTemp(NO_DATA);
        this.showUnknown(error.toString());
      }
      else {
        if (now >= this.lastForecastTime + MAX_CURRENT_TEMP_STALENESS)
          this.appService.updateCurrentTemp(NO_DATA);

        this.appService.updateCurrentTemp({ forecastStale: true });
        this.displayForecast(this.lastForecastData);
      }

      this.appService.forecastHasBeenUpdated();
    });
  }

  refreshFromCache(): void {
    if (this.lastForecastData)
      this.displayForecast(this.lastForecastData);
  }

  // Note: This is just for a temporary, quick update. The full forecast needs to be requested to get
  // accurate temperature values, especially when only integer temperature values have been supplied,
  // which don't allow for very good Celsius/Fahrenheit conversions.
  swapUnits(toMetric: boolean, knots: boolean): void {
    if (this.lastForecastData && this.lastForecastData.isMetric !== toMetric) {
      const forecast = this.lastForecastData;
      const convertT = (t: number): number => convertTemp(t, toMetric);
      const convertS = (s: number): number => s == null ? s : convertSpeed(s, toMetric);
      const convertP = (p: number): number => p == null ? p : convertPressure(p, toMetric);

      if (forecast.currently) {
        forecast.currently.feelsLikeTemperature = convertT(forecast.currently.feelsLikeTemperature);
        forecast.currently.temperature = convertT(forecast.currently.temperature);
        forecast.currently.windSpeed = convertS(forecast.currently.windSpeed);
        forecast.currently.windGust = convertS(forecast.currently.windGust);
        forecast.currently.pressure = convertP(forecast.currently.pressure);
      }

      if (forecast.hourly) {
        forecast.hourly.forEach(hour => {
          hour.temperature = convertT(hour.temperature);
          hour.windSpeed = convertS(hour.windSpeed);
          hour.windGust = convertS(hour.windGust);
          hour.pressure = convertP(hour.pressure);
        });
      }

      this.cachedHourly = [];

      if (forecast.daily?.data)
        forecast.daily.data.forEach(day => {
          day.temperatureLow = convertT(day.temperatureLow);
          day.temperatureHigh = convertT(day.temperatureHigh);
          day.windSpeed = convertS(day.windSpeed);
          day.windGust = convertS(day.windGust);
          day.pressure = convertP(day.pressure);
        });

      forecast.isMetric = toMetric;
      forecast.knots = knots;
      this.displayForecast(forecast);
    }
  }

  clearCache(): void {
    this.lastForecastData = undefined;
    this.cachedHourly = [];
  }

  // noinspection JSUnusedGlobalSymbols
  get hourlyForecast(): HourlyForecast { return this._hourlyForecast; }
  set hourlyForecast(value: HourlyForecast) {
    if (this._hourlyForecast !== value) {
      const display = (value === HourlyForecast.NONE ? 'none' : 'block');

      this._hourlyForecast = value;
      this.hourIcons.forEach(icon => icon.style.display = display);
      this.hourTemps.forEach(temp => temp.style.display = display);
      this.hourPops.forEach(pop => pop.style.display = display);
      this.forecastMarkers.css('display', value === HourlyForecast.CIRCULAR ? 'block' : 'none');
      this.decorateClockFace();

      // Force back to hourly temps
      this.showingHourTemps = false;
      this.toggleHourInfo();
    }
  }

  private updateHourlyCache(forecastData: ForecastData): void {
    const now = this.appService.getCurrentTime() / 1000;
    let earliestNew = forecastData.hourly[0]?.time ?? Number.MAX_SAFE_INTEGER;
    let inserted = 0;

    this.cachedHourly = this.cachedHourly.filter(hour => hour.time >= now - 7200 && hour.time <= now);

    if (now < earliestNew) {
      this.cachedHourly.forEach(hour => {
        if (hour.time < earliestNew)
          forecastData.hourly.splice(inserted++, 0, hour);
      });
    }

    earliestNew = forecastData.hourly[0]?.time ?? Number.MAX_SAFE_INTEGER;

    // Still nothing to cover the current hour? Fake it from current conditions.
    if (now < earliestNew && forecastData?.currently)
      forecastData.hourly.splice(0, 0, {
        icon: forecastData.currently.icon,
        precipProbability: forecastData.currently.precipProbability,
        precipType: forecastData.currently.precipType,
        temperature: forecastData.currently.temperature,
        time: floor(now / 3600) * 3600
      });

    for (let i = inserted; i < forecastData.hourly.length; ++i) {
      const t = forecastData.hourly[i].time;

      if (t <= now + 7200 && (this.cachedHourly.length === 0 || t > last(this.cachedHourly).time))
        this.cachedHourly.push(forecastData.hourly[i]);
      else
        break;
    }
  }

  showUnknown(error?: string): void {
    this._hasGoodData = false;
    setSvgHref(this.currentIcon, UNKNOWN_ICON);
    this.appService.updateCurrentTemp(NO_DATA);
    this.hourIcons.forEach(icon => icon.setAttribute('href', EMPTY_ICON));
    this.hourWinds.forEach(wind => wind.innerHTML = '');
    this.hourTemps.forEach(temp => temp.textContent = '');
    this.hourPops.forEach(pop => pop.textContent = '');
    this.wind.css('display', 'none');
    this.windPointer.css('display', 'none');
    this.windArc.css('display', 'none');
    this.windGustArc.css('display', 'none');
    this.pressure.css('display', 'none');

    this.dailyWinds.forEach(wind => wind.html(''));

    this.dayIcons.forEach((dayIcon, index) => {
      setSvgHref(dayIcon, UNKNOWN_ICON);
      this.dayLowHighs[index].text('--°/--°');
      this.dayChancePrecips[index].html('--' + PCT);
      this.dayPrecipAccums[index].text('--');
    });

    if (error) {
      this.marqueeOuterWrapper.css('background-color', ERROR_BACKGROUND);
      this.marqueeOuterWrapper.css('color', ERROR_FOREGROUND);
    }
    else {
      this.marqueeOuterWrapper.css('background-color', DEFAULT_BACKGROUND);
      this.marqueeOuterWrapper.css('color', DEFAULT_FOREGROUND);
    }

    this.updateMarqueeAnimation([{ altText: error || '\u00A0' }]);
  }

  getTimezone(): Timezone {
    return this.timezone;
  }

  getFrequent(): boolean {
    return !!this.lastForecastData?.frequent;
  }

  private async getForecast(latitude: number, longitude: number, isMetric: boolean, knots: boolean, userId?: string): Promise<ForecastData> {
    let url = `${this.weatherServer}/forecast/?lat=${latitude}&lon=${longitude}&du=${isMetric ? 'c' : 'f'}`;

    if (userId)
      url += '&id=' + encodeURI(userId);

    if (this.appService.getWeatherOption())
      url += '&pws=' + this.appService.getWeatherOption();

    const options: JsonOptions = {};
    const data = await getJson<ForecastData>(url, options);
    const cacheControl = options.xhr.getResponseHeader('cache-control');

    if (cacheControl && isObject(data)) {
      const match = /max-age=(\d+)/.exec(cacheControl);

      if (match && Number(match[1]) <= FREQUENT_THRESHOLD)
        data.frequent = true;
    }

    if (!data || !isObject(data) || data.unavailable)
      throw new Error('Forecast unavailable');
    else if (!data.currently || !data.daily || !data.daily.data || data.daily.data.length === 0)
      throw new Error('Incomplete data');

    data.isMetric = isMetric;
    data.knots = knots;

    return data;
  }

  getIconSource(icon: string): string {
    if (/^\d\d\w*$/.test(icon))
      return `assets/indexed-weather/${icon}.svg`;
    else
      return `assets/${icon}.svg`;
  }

  private displayForecast(forecastData: ForecastData): void {
    this.timezone = (Timezone.getTimezone)(forecastData.timezone);

    const now = this.appService.getCurrentTime();
    const today = new DateTime(now, this.timezone).wallTime;
    const startOfHour = new DateTime({ y: today.y, m: today.m, d: today.d, hrs: today.hrs, min: 0, sec: 0 }, this.timezone).utcTimeMillis;
    const firstHourIndex = forecastData.hourly.findIndex(hourInfo => hourInfo.time * 1000 >= startOfHour);
    const vertical = (this.hourlyForecast === HourlyForecast.VERTICAL);
    const timeFormat = this.appService.getTimeFormat();
    const isMetric = forecastData.isMetric;
    let previousStartOfHour = startOfHour - 3_600_000;

    // noinspection DuplicatedCode
    for (let i = 0; i < 24; ++i) {
      let icon = EMPTY_ICON;
      let temp = '';
      let pop = '';
      const hourInfo = forecastData.hourly[i + firstHourIndex];
      const startOfHour = hourInfo ? hourInfo.time * 1000 : previousStartOfHour + 3_600_000;
      const hour = new DateTime(startOfHour, this.timezone).wallTime;
      let index: number;

      if (vertical)
        index = i;
      else {
        // Account for skipped or repeated hours caused by DST change.
        const hourDelta = hour.hrs - today.hrs + 24 * (hour.n - today.n);

        index = (hour.hrs % 12) % 12 + floor(hourDelta / 12) * 12;
      }

      if (hourInfo && firstHourIndex >= 0) {
        icon = this.getIconSource(hourInfo.icon);
        temp = hourInfo.temperature.toFixed(0) + '°';
        pop = hourInfo.precipProbability != null ? round(hourInfo.precipProbability * 100) + PCT : '--' + PCT;

        if (vertical && (i <= 3 || (8 <= i && i <= 15) || i >= 20)) {
          const hourText = `<tspan class="temp-by-hour">${formatHour(hour.hrs, timeFormat === TimeFormat.AMPM, true)}</tspan>`;

          if (i < 12) {
            temp += ' ' + hourText;
            pop += ' ' + hourText;
          }
          else {
            temp = hourText + ' ' + temp;
            pop = hourText + ' ' + pop;
          }
        }
      }

      if (this.hourIcons[index])
        this.hourIcons[index].setAttribute('href', icon);

      if (this.hourWinds[index]) {
        if (hourInfo) {
          const speed = hourInfo.windSpeed ?? forecastData.currently.windSpeed;
          const gust = hourInfo.windGust ?? forecastData.currently.windGust;
          const direction = hourInfo.windDirection ?? forecastData.currently.windDirection;

          this.hourWinds[index].innerHTML = windBarbsSvg(speed, gust, isMetric, forecastData.knots, direction);
        }
        else
          this.hourWinds[index].innerHTML = '';
      }

      // noinspection DuplicatedCode
      if (this.hourTemps[index]) {
        this.hourTemps[index].innerHTML = temp;
        this.hourTemps[index].style.fontSize = (!vertical && temp.length > 3 ? '1.25px' : '1.6px');
        this.hourTemps[index].style.fontStyle = (hour.d !== today.d ? 'italic' : 'normal');
      }

      // noinspection DuplicatedCode
      if (this.hourPops[index]) {
        this.hourPops[index].innerHTML = pop;
        this.hourPops[index].style.fontSize = (!vertical && pop.length - PCT.length > 2 ? '1.25px' : '1.6px');
        this.hourPops[index].style.fontStyle = (hour.d !== today.d ? 'italic' : 'normal');
      }

      previousStartOfHour = startOfHour;
    }

    this.todayIndex = forecastData.daily.data.findIndex(cond => {
      const wallTime = new DateTime(cond.time * 1000, this.timezone).wallTime;

      return wallTime.y === today.y && wallTime.m === today.m && wallTime.d === today.d;
    });

    if (this.todayIndex < 0)
      this.showUnknown('Missing data');
    else {
      this.appService.updateCurrentTemp({
        forecastFeelsLike: forecastData.currently.feelsLikeTemperature,
        forecastHumidity: forecastData.currently.humidity * 100,
        forecastTemp: forecastData.currently.temperature,
      });

      this.displayCurrentWind(forecastData.currently, isMetric, forecastData.knots);
      this.displayCurrentPressure(forecastData.currently, isMetric);
      this.displayAirQuality(forecastData);
      setSvgHref(this.currentIcon, this.getIconSource(forecastData.currently.icon));

      this.dayIcons.forEach((dayIcon, index) => {
        const wind = this.dailyWinds[index];

        if (forecastData.daily.data.length > this.todayIndex + index) {
          const daily = forecastData.daily.data[this.todayIndex + index];
          const textElem = this.dayPrecipAccums[index];

          wind.html(windBarbsSvg(daily.windSpeed, daily.windGust, isMetric, forecastData.knots, daily.windDirection, true));
          setSvgHref(dayIcon, this.getIconSource(daily.icon));

          const low = round(daily.temperatureLow);
          const high = round(daily.temperatureHigh);

          this.dayLowHighs[index].text(`${high}°/${low}°`);

          let chancePrecip = round(daily.precipProbability * 100) + PCT;

          if (!this.rainGlyph) // Raindrop emoji, or umbrella with raindrops
            this.rainGlyph = doesCharacterGlyphExist(textElem[0], '\uD83D\uDCA7') ? '\uD83D\uDCA7' : '\u2614';

          if (!this.snowGlyph) // Snowflake emoji, or more basic snowflake character
            this.snowGlyph = doesCharacterGlyphExist(textElem[0], '\u2744\uFE0F') ? '\u2744\uFE0F' : '\u2744';

          if (daily.precipType === 'snow')
            chancePrecip = this.snowGlyph + chancePrecip;
          else
            chancePrecip = this.rainGlyph + chancePrecip;

          this.dayChancePrecips[index].html(daily.precipProbability > 0.01 ? chancePrecip : '--');

          const accum = daily.precipAccumulation || 0;
          const precision = (accum < 0.995 ? 2 : (accum < 9.95 ? 1 : 0));

          textElem.text(accum > 0 ? accum.toFixed(precision) + (forecastData.isMetric ? ' cm' : ' in') : '--');
        }
        else {
          wind.html('');
          setSvgHref(dayIcon, UNKNOWN_ICON);
          this.dayLowHighs[index].text('--°/--°');
          this.dayChancePrecips[index].html('--' + PCT);
          this.dayPrecipAccums[index].text('--');
        }
      });

      this.refreshAlerts(forecastData);
    }

    setTimeout(reflow);
  }

  private static speedToColor(speed: number, isMetric: boolean): string {
    if (!isMetric)
      speed = convertSpeed(speed, true);

    const hue = floor(max(208 - speed * 208 / 117, 0));

    return `hsl(${hue}, 100%, 50%)`;
  }

  private static speedToSpan(speed: number, isMetric: boolean): number {
    if (!isMetric)
      speed = convertSpeed(speed, true);

    return 10 + floor(min(speed * 80 / 117, 80));
  }

  private displayCurrentWind(current: CurrentConditions, isMetric: boolean, knots: boolean): void {
    function rotate(elem: HTMLElement, deg: number): void {
      elem.setAttribute('transform', 'rotate(' + deg + ' 50 50)');
    }

    if ((current.windSpeed ?? -1) >= 0 && current.windDirection != null) {
      const speed = knots ? (isMetric ? kphToKnots(current.windSpeed) : mphToKnots(current.windSpeed)) : current.windSpeed;
      const gust = knots ? (isMetric ? kphToKnots(current.windGust) : mphToKnots(current.windGust)) : current.windGust;

      $('#wind-dir').text('Wind: ' + (speed >= 0.5 ? compassPoint(current.windDirection) : ''));
      $('#wind-speed').text(speed.toFixed(0) + (knots ? ' kts' : (isMetric ? ' km/h' : ' mph')));
      $('#wind-gust').text((gust ?? 0) > speed ? 'Gust: ' + gust.toFixed(0) : '');
      this.wind.css('display', 'block');
    }
    else
      this.wind.css('display', 'none');

    let pointerDrawn = false;

    if ((current.windSpeed ?? 0) > 0 && current.windDirection != null) {
      const span = Forecast.speedToSpan(current.windSpeed, isMetric);
      const arc = describeArc(50, 50, 45.5, current.windDirection - 90 - span / 2, current.windDirection - 90 + span / 2);
      const color = Forecast.speedToColor(current.windSpeed, isMetric);

      this.windPointer.css('fill', color);
      rotate(this.windPointer[0], current.windDirection);
      this.windArc[0].setAttribute('d', arc);
      this.windPointer.css('display', 'block');
      this.windArc.css('stroke', color);
      this.windArc.css('display', 'block');
      pointerDrawn = true;
    }
    else
      this.windArc.css('display', 'none');

    if ((current.windGust ?? 0) > 0 && current.windDirection != null) {
      const span = Forecast.speedToSpan(current.windGust, isMetric);
      const arc = describeArc(50, 50, 45, current.windDirection - 90 - span / 2, current.windDirection - 90 + span / 2);
      const color = Forecast.speedToColor(current.windGust, isMetric);

      this.windGustArc[0].setAttribute('d', arc);
      this.windGustArc.css('stroke', color);
      this.windGustArc.css('display', 'block');

      if (!pointerDrawn) {
        this.windPointer.css('fill', color);
        rotate(this.windPointer[0], current.windDirection);
        this.windPointer.css('display', 'block');
        pointerDrawn = true;
      }
    }
    else
      this.windGustArc.css('display', 'none');

    if (!pointerDrawn)
      this.windPointer.css('display', 'none');
  }

  private displayCurrentPressure(current: CurrentConditions, isMetric: boolean): void {
    if ((current.pressure ?? -1) >= 0) {
      $('#pressure-value').text(['⬇︎︎', '', '⬆︎'][(current.pressureTrend ?? 0) + 1] +
        current.pressure.toFixed(isMetric ? 0 : 2) +
        (isMetric ? ' hPa' : '"Hg'));
      this.pressure.css('display', 'block');
    }
    else
      this.pressure.css('display', 'none');
  }

  private getAirQualityColorAndCaption(valueSource: AirQualitySource, option: string, fade = false): [number, string, string, string] {
    let value: number;
    let index: number;
    let iIndex: number;
    let color: string;
    let color2: string;
    let caption: string;
    const neutral = fade ? 'none' : 'gray';

    if (option === 'E') {
      value = valueSource.aqiEu;

      if (value == null)
        return [undefined, neutral, neutral, ''];

      index = min(value / 25, 4);
      iIndex = floor(index);
      caption = euAirQualityCaptions[iIndex];
      color = color2 = euAirQualityColors[iIndex];
    }
    else {
      value = valueSource.aqiUs;

      if (value == null)
        return [undefined, neutral, neutral, ''];

      index = min(max((value - 1) / 50, 0), 9);
      iIndex = floor(index);
      caption = airQualityCaptions[iIndex];
      color = color2 = airQualityColors[iIndex];

      const diff = mod2(index, 1);

      if (option === 'UM' && abs(diff) < 0.25) {
        let color2: string;
        let proportion = (diff + 0.25) * 2;

        if (diff < 0)
          color2 = airQualityColors[iIndex + 1];
        else {
          color2 = airQualityColors[iIndex - 1];
          proportion = 1 - proportion;
        }

        color = blendColors(color2, color, proportion);
      }
    }

    if (fade) {
      color = blendColors(color, 'white', 0.4);
      color2 = blendColors(color2, 'white', 0.4);
    }

    return [value, color, color2, caption];
  }

  private displayAirQuality(forecast: ForecastData): void {
    const option = this.appService.getAirQualityOption() || '';

    if (option !== 'E' && !option.startsWith('U')) {
      this.pressure.attr('y', '39');
      this.airQuality.css('display', 'none');

      for (let i = 0; i < this.dayBackgrounds.length; ++i) {
        this.dayBackgrounds[i].setAttribute('fill', 'none');
        this.dayHeaders[i].setAttribute('fill', 'white');
      }

      return;
    }

    this.airQuality.css('display', 'block');
    this.pressure.attr('y', '35');

    const current = forecast.currently;

    if (option === 'E' && current.aqiEu == null || option.startsWith('U') && current.aqiUs == null) {
      this.airQualityColor.css('fill', 'gray');
      this.airQualityValue.text('--');
      this.airQualityText.css('fill', 'black');

      return;
    }

    const [value, color, color2, caption] = this.getAirQualityColorAndCaption(current, option);

    this.airQualityValue.text(value.toString());
    this.airQualityColor.css('fill', color);
    this.airQualityColor2.css('fill', color2);
    this.airQualityText.css('fill', matchingTextColor(color2));

    if (caption.includes('\n')) {
      const [line1, line2] = caption.split('\n');

      this.airQualityCaption.text('');
      this.airQualityCaption1.text(line1);
      this.airQualityCaption2.text(line2);
    }
    else {
      this.airQualityCaption.text(caption);
      this.airQualityCaption1.text('');
      this.airQualityCaption2.text('');
    }

    const daily = forecast.daily?.data.slice(this.todayIndex) ?? [];

    for (let i = 0; i < this.dayBackgrounds.length; ++i) {
      const background = this.dayBackgrounds[i];
      const header = this.dayHeaders[i];
      const [value, color, color2] = this.getAirQualityColorAndCaption(daily[i], option);

      if (i < daily.length && value != null) {
        background.setAttribute('fill', color);
        header.setAttribute('fill', matchingTextColor(color2));
      }
      else {
        background.setAttribute('fill', 'none');
        header.setAttribute('fill', 'white');
      }
    }
  }

  refreshAlerts(forecastData = this.lastForecastData): void {
    let maxSeverity = 0;
    const alerts: DisplayedAlert[] = [];
    const droppedAlerts: Alert[] = [];
    const now = this.appService.getCurrentTime();

    if (this.appService.sensorDeadAir())
      alerts.push({ asError: true, altText: 'WIRELESS TEMPERATURE/HUMIDITY SIGNAL NOT PRESENT - possible disconnect or bad pin assignment' });

    if (forecastData?.daily.summary)
      alerts.push({ altText: forecastData.daily.summary });

    if (forecastData?.alerts) {
      forecastData.alerts.forEach(alert => {
        alert = clone(alert);

        const expires = alert.expires * 1000;

        if (expires >= now) {
          const severities = ['advisory', 'watch', 'warning'];
          const allowed = this.alertAllowed(alert);
          const severity = severities.indexOf(alert.severity) + 1;

          if (allowed) {
            if (!this.isAlertAcknowledged(alert.id))
              maxSeverity = max(severity, maxSeverity);

            alerts.push({ alert, acknowledged: this.isAlertAcknowledged(alert.id) });
          }
          else
            droppedAlerts.push(alert);
        }
      });
    }

    if (demoServer) {
      const indoor = this.appService.getIndoorOption() !== 'X';
      const outdoor = this.appService.getOutdoorOption() !== 'F';

      if (indoor && outdoor)
        alerts.push({ altText: 'NOTE: Indoor/outdoor temperature and humidity are simulated', asNotification: true });
      else if (indoor)
        alerts.push({ altText: 'NOTE: Indoor temperature and humidity are simulated', asNotification: true });
      else if (outdoor)
        alerts.push({ altText: 'NOTE: Outdoor temperature and humidity are simulated', asNotification: true });
    }

    let background: string;
    let color: string;

    if (alerts.length + droppedAlerts.length > 0) {
      switch (maxSeverity) {
        case 0:
          background = document.defaultView.getComputedStyle(document.body, null).getPropertyValue('background-color');
          color = DEFAULT_FOREGROUND;
          break;

        case 1:
          background = ADVISORY_BACKGROUND;
          color = ADVISORY_FOREGROUND;
          break;

        case 2:
          background = WATCH_BACKGROUND;
          color = WATCH_FOREGROUND;
          break;

        case 3:
          background = WARNING_BACKGROUND;
          color = WARNING_FOREGROUND;
          break;
      }
    }
    else {
      background = DEFAULT_BACKGROUND;
      color = DEFAULT_FOREGROUND;
    }

    this.marqueeBackground = background;
    // It shouldn't be necessary to update colors for both marqueeOuterWrapper and marqueeWrapper, but Chrome doesn't seem.
    // to pass through the inheritance of the background color all the time. Also doing foreground for good measure.
    this.marqueeOuterWrapper.css('background-color', background);
    this.marqueeWrapper.css('background-color', background);
    this.marqueeOuterWrapper.css('color', color);
    this.marqueeWrapper.css('color', color);
    this.updateMarqueeAnimation(alerts, droppedAlerts);
  }

  private alertAllowed(alert: Alert): boolean {
    const title = alert.title.toLowerCase();
    const fullText = title + '\n' + alert.description.toLowerCase().replace(/\s+/g, ' ').trim();
    const filters = this.appService.getAlertFilters();

    return filters.findIndex(filter => {
      const text = (filter.checkDescription ? fullText : title);
      const $ = /^\/([^/]+)\/(u?)$/.exec(filter.content.trim());
      let matched: boolean;

      if ($)
        matched = new RegExp($[1], 'i' + $[2]).test(text);
      else
        matched = text.includes(filter.content.toLowerCase());

      if (matched) {
        if (filter.type === AlertFilterType.HIDE)
          return true;
        else
          alert.severity = 'info';
      }

      return false;
    }) < 0;
  }

  private checkAspectRatio(): void {
    const aspectRatio = window.innerWidth / window.innerHeight;
    const lastVisible = this.forecastDaysVisible;

    this.forecastDaysVisible = (aspectRatio > SIXTEEN_BY_NINE ? 5 : 4);

    if (this.forecastDaysVisible !== lastVisible) {
      const width = this.forecastDaysVisible * FORECAST_DAY_WIDTH;
      const extraWidth = (this.forecastDaysVisible - 4) * FORECAST_DAY_WIDTH;

      $('#clock-container, #clock-overlay, #planet-overlay').toggleClass('display16x9', this.forecastDaysVisible > 4);
      $('#clock, #clock-overlay-svg, #planet-overlay-svg').attr('viewBox', `0 0 ${172 + extraWidth} 108`);
      $('#current-forecast').attr('transform', `translate(${extraWidth / 2})`);
      $('#forecast-rect').attr('width', width.toString());
      $('#forecast-clip').attr('width', width.toString());
      $('#end-of-week').attr('to', `-${(7 - this.forecastDaysVisible) * FORECAST_DAY_WIDTH} 0`);
      $('#forecast-week').attr('clip-path', `url(#forecast-clip-${this.forecastDaysVisible})`);
      $('#week-forward').attr('transform', `translate(${extraWidth})`);
    }
  }

  private updateMarqueeAnimation(alerts: DisplayedAlert[], droppedAlerts?: Alert[]): void {
    const newAlerts = { alerts, droppedAlerts };

    if (alerts !== null || droppedAlerts != null) {
      if (isEqual(this.currentAlerts, newAlerts))
        return;
      else
        this.currentAlerts = newAlerts;
    }

    if (!alerts)
      alerts = this.currentAlerts.alerts;

    const acknowledgedAlerts = (alerts || []).filter(a => a.alert && this.isAlertAcknowledged(a.alert.id)).map(a => a.alert);
    const symbols = acknowledgedAlertSymbols(acknowledgedAlerts) + droppedAlertSymbols(droppedAlerts);
    const newText = concatenateAlerts(alerts) + (symbols ? BULLET_SPACER + symbols : '');
    const marqueeWidth = floor(this.marqueeWrapper[0].offsetWidth);
    const textWidth = getTextWidth(convertForWidthMeasurement(newText), this.marquee[0]);

    this.marquee.css('width', marqueeWidth + 'px');
    this.marquee.css('text-indent', '0');

    // Create alert dialog text, trying to undo hard word-wrap.
    this.marqueeDialogText = (concatenateAlerts(alerts, true)
        + (droppedAlerts ? BULLET_SPACER + concatenateAlerts(droppedAlerts, true, true) : ''))
      .replace(BULLET_REGEX, '\n<hr>').replace(/([-\da-z,])\n(?=[a-z]|(\d[^.#*)\]]))/gi, '$1 ')
      // No more than one blank line, and no trailing blank lines.
      .replace(/\n{3,}/g, '\n\n').trim().replace(/\n/g, '<br>\n')
      // Remove hidden alert icons.
      .replace(/ (\uD83D[\uDD34-\uDD35\uDFe0])+/, '');

    if (textWidth <= marqueeWidth) {
      this.marquee.html(newText);
      this.animationStart = 0;
      this.appService.updateMarqueeState(false);

      if (this.animationRequestId) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = 0;
      }
    }
    else {
      this.marquee.html(newText + MARQUEE_JOINER + newText);
      this.animationStart = performance.now() + 1000;
      this.animationWidth = textWidth + getTextWidth(MARQUEE_JOINER, this.marquee[0]);
      this.animationRequestId = window.requestAnimationFrame(() => this.animate());
      this.appService.updateMarqueeState(true);
    }
  }

  private animate(): void {
    if (!this.animationStart)
      return;

    const now = performance.now();
    const timeIntoScroll = max(now - this.animationStart, 0);
    const scrollOffset = (timeIntoScroll / 1000 * MARQUEE_SPEED) % this.animationWidth;

    if (isChrome()) {
      // This is a silly game of tweaking the height of the marquee to work around a Chrome bug
      //   where changes in CSS text-indent are otherwise ignored.
      const parentHeight = this.marquee.parent().height();
      const height = this.marquee.height();

      this.marquee.css('height', (height === parentHeight ? parentHeight - 0.25 : parentHeight) + 'px');
    }

    this.marquee.css('text-indent', `-${scrollOffset}px`);
    this.animationRequestId = window.requestAnimationFrame(() => this.animate());
  }

  private acknowledgeAlert(id: string, state?: boolean): void {
    const alerts = this.appService.getHiddenAlerts();
    const acknowledged = this.isAlertAcknowledged(id);
    const wrapper = document.querySelector(`#X${id}_aw`) as HTMLElement;

    if (state == null)
      state = !acknowledged;

    if (state && !acknowledged) {
      this.appService.updateHiddenAlerts(push(alerts,
        { id, expires: this.currentAlerts.alerts?.find(a => a.alert?.id === id)?.alert.expires ?? 0 }));

      if (wrapper)
        wrapper.style.height = wrapper.getBoundingClientRect().height + 'px';

      setTimeout(() => wrapper?.classList.add('collapsed'));
    }
    else if (!state && acknowledged) {
      this.appService.updateHiddenAlerts(alerts.filter(a => a.id !== id));
      wrapper.classList.remove('collapsed');
    }
  }

  private isAlertAcknowledged(id: string): boolean {
    return !!this.appService.getHiddenAlerts().find(a => a.id === id);
  }

  private showMarqueeDialog(): void {
    const color = (this.marqueeBackground === 'inherit' ? $('body').css('--background-color') : this.marqueeBackground);

    displayHtml('big-text-dialog', this.marqueeDialogText, blendColors(color, 'white', 0.25), () => {
      this.refreshAlerts();
      this.appService.updateSettings();
    });

    let tries = 0;
    const addAlertButtonListeners = (): void => {
      let needed = 0;
      const found = new Map<string, HTMLInputElement>();

      for (const alert of this.currentAlerts?.alerts ?? []) {
        if (alert.alert?.id) {
          const id = alert.alert.id;
          const cb = document.querySelector(`#X${id}_cb`) as HTMLInputElement;

          ++needed;

          if (cb)
            found.set(id, cb);
        }
      }

      if (found.size < needed && ++tries < 20)
        setTimeout(addAlertButtonListeners, 100);
      else {
        found.forEach((elem, id) => {
          const ack = this.isAlertAcknowledged(id);

          elem.addEventListener('click', this.alertAcknowledgeClick);
          $(elem).prop('checked', ack);
          document.querySelector(`#X${id}_at`)?.addEventListener('click', this.alertAcknowledgeClick);
          document.querySelector(`#X${id}_aw`)?.classList[ack ? 'add' : 'remove']('collapsed');
        });
      }

      Array.from(document.querySelectorAll('.alert-wrapper .alert-filtered') || []).forEach(elem => {
        elem.addEventListener('click', this.toggleAlertCollapse);
        elem.parentElement.classList.add('collapsed');
      });
    };

    addAlertButtonListeners();
  }

  private toggleAlertCollapse = (evt: MouseEvent): void => {
    let elem = evt.target as (HTMLElement);

    while (elem && !elem.classList.contains('alert-wrapper'))
      elem = elem.parentElement;

    if (elem) {
      const collapsed = elem.classList.contains('collapsed');

      if (!collapsed)
        elem.style.height = elem.getBoundingClientRect().height + 'px';

      setTimeout(() => $(elem).toggleClass('collapsed'));
    }
  };

  private alertAcknowledgeClick = (evt: MouseEvent): void => {
    const target = (evt.target as HTMLElement);
    const id = target.id?.slice(1, -3);

    if (id && target.localName !== 'input')
      (document.querySelector(`#X${id}_cb`) as HTMLInputElement)?.click();
    else {
      const checked = $(target).prop('checked');

      this.acknowledgeAlert(id, checked);
    }

    evt.stopPropagation();
  };

  private showDayForecast(dayIndex: number): void {
    const day = this.todayIndex >= 0 && this.lastForecastData?.daily?.data[this.todayIndex + dayIndex];
    const narrativeDay = day?.narrativeDay;
    const narrativeEvening = day?.narrativeEvening;

    if (!narrativeDay && !narrativeEvening) {
      // No forecast details available
      return;
    }

    const tempUnit = this.lastForecastData.isMetric ? 'C' : 'F';
    let text = '¬b¬' + localDateString(day.time * 1000, this.timezone) +
      `¬b; • ${day.temperatureHigh}°${tempUnit} / ${day.temperatureLow}°${tempUnit}`;

    if (day.aqiUs)
      text += `, AQI: ${day.aqiUs}`;

    text += '\n\n';

    if (narrativeDay && narrativeEvening)
      text += `${narrativeDay}\n\nEvening: ${narrativeEvening}`;
    else if (narrativeDay)
      text += narrativeDay;
    else
      text += narrativeEvening;

    text = htmlEscape(text).replace(/\n{3,}/g, '\n\n').trim().replace(/\n/g, '<br>\n')
      .replace(/¬(.+?)¬/g, '<$1>').replace(/¬(.+?);/g, '</$1>');

    displayHtml('big-text-dialog', text, '#DDF');
  }

  private toggleHourInfo(): void {
    if (this.hourInfoTimer) {
      clearTimeout(this.hourInfoTimer);
      this.hourInfoTimer = undefined;
    }

    const iconElems = $('.hour-icon');
    const windElems = $('.hour-wind');
    const tempElems = $('.hour-temps');
    const popElems = $('.hour-pops');

    if (this.showingHourTemps) {
      this.showingHourTemps = false;

      this.hourInfoTimer = setTimeout(() => {
        this.hourInfoTimer = undefined;

        if (!this.showingHourTemps)
          this.toggleHourInfo();
      }, REVERT_TO_SUN_INFO_DELAY);
    }
    else
      this.showingHourTemps = true;

    windElems.toggleClass('hour-info-show', !this.showingHourTemps).toggleClass('hour-info-hide', this.showingHourTemps);
    iconElems.toggleClass('hour-info-hide', !this.showingHourTemps).toggleClass('hour-info-show', this.showingHourTemps);
    popElems.toggleClass('hour-info-show', !this.showingHourTemps).toggleClass('hour-info-hide', this.showingHourTemps);
    tempElems.toggleClass('hour-info-hide', !this.showingHourTemps).toggleClass('hour-info-show', this.showingHourTemps);
  }

  private createAqiTableRow(source: CurrentConditions | HourlyConditions | DailyConditions,
                            showDate: boolean, showOnlyDate = false): string {
    let row = '';
    const am = this.appService.getTimeFormat() === TimeFormat.AMPM;
    const aqiOption = this.appService.getAirQualityOption();

    const time = floor(source.time, 3600) * 1000;
    const timeStamp = showOnlyDate ? localShortDate(time, this.timezone) :
      showDate ? localShortDateTime(time, this.timezone, am) : localShortTime(time, this.timezone, am);
    const [aqi, color, color2] = this.getAirQualityColorAndCaption(source, aqiOption);
    const pAqiMax = max(...Object.values(source.aqComps)
      .map(value => (aqiOption === 'E' ? value.aqiEu : value.aqiUs) ?? -1));
    const aqiStyle = `background-color: ${color2}; color: ${matchingTextColor(color2)}`;
    const aqiStyle2 = `background-color: ${color}; color: ${matchingTextColor(color2)}`;
    const createCell = (pollutant: string, digits: number): string => {
      const data = source.aqComps[pollutant] as AirQualityValues;

      if (data?.raw == null)
        return '<td>???</td>';

      const [pAqi, pColor, pColor2] = this.getAirQualityColorAndCaption(data, aqiOption, true);
      let cell = `<td style="background-color: ${pColor2}"><span style="background-color: ${pColor}`;

      if (pAqi >= pAqiMax)
        cell += '; font-weight: bold';

      cell += `">${data.raw.toFixed(digits)}</span></td>`;

      return cell;
    };

    row += '  <tr>\n';
    row += `    <td${showOnlyDate ? ' style="text-align: left"' : ''}>${timeStamp}</td>\n`;
    row += `    <td style="${aqiStyle}"><span style="${aqiStyle2}">${aqi}</span></td>\n`;
    row += `    ${createCell('o3', 0)}\n`;
    row += `    ${createCell('pm10', 0)}\n`;
    row += `    ${createCell('pm2_5', 1)}</td>\n`;
    row += `    ${createCell('co', 0)}\n`;
    row += `    ${createCell('so2', 1)}\n`;
    row += `    ${createCell('no2', 1)}\n`;
    row += '  </tr>\n';

    return row;
  }

  private showAirQualityDetails(): void {
    let html = '';
    let lastDay: number;
    let lastTime = -1;
    const hours = this.lastForecastData?.hourly;
    const days = this.lastForecastData?.daily?.data;

    html += '<div class="table-wrapper"><table>\n';
    html += '  <tr><th class="title" colspan=8>Air Quality Details</th></tr>\n';
    html += '  <tr>\n';
    html += '    <th class="subtitle"></th><th class="subtitle"></th>\n';
    html += '    <th class="subtitle" colspan=6>Pollutant values in μg/m³, key pollutants in bold</th>\n';
    html += '  </tr>\n';
    html += '  <tr>\n';
    html += '    <th>Date/time</th>\n';
    html += '    <th>AQI</th>\n';
    html += '    <th>O<sub>3</sub></th>\n';
    html += '    <th>PM<sub>10</sub></th>\n';
    html += '    <th>PM<sub>2.5</sub>\n';
    html += '    <th>CO</th>\n';
    html += '    <th>SO<sub>2</sub>\n';
    html += '    <th>NO<sub>2</sub>\n';
    html += '  </tr>\n';

    html += this.createAqiTableRow(this.lastForecastData?.currently, true);
    lastDay = new DateTime(this.lastForecastData?.currently.time * 1000, this.timezone).wallTime.d;

    for (const hour of hours) {
      if (hour.time < this.lastForecastData?.currently.time || !hour.aqComps)
        continue;

      const wallTime = new DateTime(hour.time * 1000, this.timezone).wallTime;

      html += this.createAqiTableRow(hour, lastDay !== wallTime.d);
      lastDay = wallTime.d;
      lastTime = hour.time;
    }

    for (const day of days) {
      if (day.time < lastTime || !day.aqComps)
        continue;

      html += this.createAqiTableRow(day, true, true);
      lastTime = day.time;
    }

    html += '</table></div>\n';
    displayHtml('air-quality-details', html, 'white');
  }
}
