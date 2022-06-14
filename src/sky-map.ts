import { AppService } from './app.service';
import {
  AsteroidCometInfo, AVG_SUN_MOON_RADIUS, Ecliptic, getSkyColor, ISkyObserver, JUPITER, LABEL_ANCHOR, LINE_BREAK, MARS, MERCURY,
  MOON, NUTATION, REFRACTION, SATURN, SkyObserver, SolarSystem, StarCatalog, SUN, TOPOCENTRIC, VENUS
} from '@tubular/astronomy';
import { getBinary } from './awc-util';
import ttime from '@tubular/time';
import julianDay = ttime.julianDay;
import {
  abs, Angle, atan2_deg, cos_deg, floor, intersects, max, min, mod, mod2, PI, Point, pow, Rectangle, round, sin_deg, SphericalPosition,
  SphericalPosition3D, sqrt, to_radian, TWO_PI, Unit
} from '@tubular/math';
import { blendColors, colorFromRGB, fillCircle, getFontMetrics, getTextWidth, strokeLine } from '@tubular/util';

export interface LabelInfo {
  bodyIndex: number;
  labelBounds?: Rectangle;
  name: string;
  offsetX: number;
  overlapped?: boolean;
  pt: Point;
  textPt?: Point;
}

interface DrawingContext {
  context: CanvasRenderingContext2D;
  facing: number;
  heavyLabels?: boolean;
  jde: number;
  jdu: number;
  labels: LabelInfo[];
  minStarBrightness?: number;
  pixelsPerArcSec: number;
  planetFlags?: number;
  radius: number;
  scaleBoost?: number;
  size: number;
  skyObserver: ISkyObserver;
  starBrightestLevel?: number;
  starDimmestLevel?: number;
  starLevelRange?: number;
  xctr: number;
  yctr: number;
}

export interface SortablePlanet {
  planet: number;
  pos: SphericalPosition3D;
}

const opacitiesOfWhite: string[] = [];

for (let i = 0; i <= 255; ++i) {
  opacitiesOfWhite[i] = 'rgba(255,255,255,' + (i / 255).toFixed(3) + ')';
}

const SCALE_WHERE_BRIGHTEST_STAR_IS_3x3 = 0.0026;
const DIMMEST_ALLOWED_1x1_STAR_IMAGE_INDEX  = 33;
const DIMMEST_AT_SCALE_1x1_STAR_IMAGE_INDEX = 100;
const BRIGHTEST_1x1_STAR_IMAGE_INDEX        = 500;
const BRIGHTEST_3x3_STAR_IMAGE_INDEX        = 1500;
const DEFAULT_SKY_RESOLUTION = 5;

const planetColors = [
  'yellow',  '#C0C0C0', '#EEEEFF', /* eslint-disable-line no-multi-spaces */ // Sun, Mercury, Venus */
  '#00CCCC', 'red',     'orange',  /* eslint-disable-line no-multi-spaces */ // Earth, Mars, Jupiter
  'yellow', '', '', '', '#EEEEFF'  /* eslint-disable-line no-multi-spaces */ // Saturn, Moon
];

// These color specifications are left incomplete so that the alpha value can be varied.
const SHADED_MOON            = '#69C';
const ILLUMINATED_MOON       = 'white';
const ECLIPSED_MOON          = '#850';

const CONSTELLATION_LINE_COLOR = '#0000FF';

const planetsToDraw = [SUN, MERCURY, VENUS, MOON, MARS, JUPITER, SATURN];

const labelFont = '12px Arial, Helvetica, sans-serif';
const labelMetrics = getFontMetrics(labelFont);
const LABEL_X_OFFSET = 5;
const LABEL_Y_OFFSET = 4;

export class SkyMap {
  private static starData: ArrayBuffer;
  private static starDataPromise: Promise<ArrayBuffer>;

  private ecliptic = new Ecliptic();
  private firstMag5 = 0;
  private minAlt = -0.00833;
  private solarSystem = new SolarSystem();
  private starCatalog: StarCatalog;

  constructor(private appService: AppService) {
    this.starCatalog = new StarCatalog({
      getStars: (): Promise<ArrayBuffer> => {
        if (SkyMap.starData)
          return Promise.resolve(SkyMap.starData);
        else if (SkyMap.starDataPromise)
          return SkyMap.starDataPromise;

        SkyMap.starDataPromise = getBinary('/assets/stars.dat').then(data => {
          SkyMap.starData = data;

          return SkyMap.starData;
        });

        return SkyMap.starDataPromise;
      },
      getAsteroidData(): Promise<AsteroidCometInfo[]> { return Promise.resolve(null); },
      getCometData(): Promise<AsteroidCometInfo[]> { return Promise.resolve(null); },
      getGrsData(): Promise<ArrayBuffer> { return Promise.resolve(null); },
    }, initialized => {
      if (initialized) // noinspection CommaExpressionJS
        this.starCatalog.forEach((star, index) => star.vmag <= 5 ? (this.firstMag5 = index, false) : true);
      else
        this.starCatalog = undefined;
    });
  }

  draw(canvas: HTMLCanvasElement, longitude: number, latitude: number, time?: number): void {
    if (!this.starCatalog)
      return;
    else if (this.firstMag5 === 0) {
      setTimeout(() => this.draw(canvas, longitude, latitude), 100);
      return;
    }

    const jdu = julianDay(time ?? this.appService.getCurrentTime());
    const width = parseFloat(canvas.style.width);
    const height = parseFloat(canvas.style.height);
    const radius = floor(min(width, height) / 2 * 0.95);
    const canvasScaling = canvas.width / width;
    const dc = {
      context: canvas.getContext('2d'),
      facing: this.appService.skyFacing,
      labels: [],
      jde: ttime.utToTdt(jdu),
      jdu,
      pixelsPerArcSec: radius * 0.95 / 90.0 / 3600.0,
      planetFlags: NUTATION | REFRACTION,
      radius,
      size: radius * 2,
      skyObserver: new SkyObserver(longitude, latitude),
      xctr: round(width / 2),
      yctr: round(height / 2)
    } as DrawingContext;

    dc.scaleBoost = pow(dc.pixelsPerArcSec * 1.5 / SCALE_WHERE_BRIGHTEST_STAR_IS_3x3, 0.521);
    dc.starBrightestLevel = min(round(dc.scaleBoost * BRIGHTEST_3x3_STAR_IMAGE_INDEX), 1999);
    dc.starDimmestLevel = min(max(min(round(dc.scaleBoost * DIMMEST_AT_SCALE_1x1_STAR_IMAGE_INDEX), 1999),
                              DIMMEST_ALLOWED_1x1_STAR_IMAGE_INDEX), BRIGHTEST_1x1_STAR_IMAGE_INDEX);
    dc.starLevelRange = dc.starBrightestLevel - dc.starDimmestLevel;

    dc.context.setTransform(canvasScaling, 0, 0, canvasScaling, 0, 0);
    dc.context.font = labelFont;

    this.drawSky(dc);
    this.drawConstellations(dc);
    this.drawStars(dc);
    this.drawPlanets(dc);
    SkyMap.cleanUpEdges(dc);
    SkyMap.drawLabels(dc);
  }

  private drawSky(dc: DrawingContext): void {
    const sunPos = this.solarSystem.getHorizontalPosition(SUN, dc.jdu, dc.skyObserver, dc.planetFlags);
    const alt = sunPos.altitude.degrees;
    const totality = this.solarSystem.getLocalSolarEclipseTotality(dc.jde, dc.skyObserver);
    let skyColor: string;

    if (alt < -18 || !this.appService.showSkyColors)
      skyColor = 'black';
    else if (alt < 0) {
      const shade = (18 + alt) / 18;

      dc.minStarBrightness = round(shade * 153);
      skyColor = colorFromRGB(shade * 51, shade * 51, dc.minStarBrightness);
    }
    else {
      dc.minStarBrightness = 153;
      skyColor = '#333399';
    }

    dc.heavyLabels = (alt > -15 && this.appService.showSkyColors);

    if (this.appService.showSkyColors && alt >= -18) {
      const skyResolution = DEFAULT_SKY_RESOLUTION;

      const minAlt2 = this.minAlt - skyResolution / dc.pixelsPerArcSec / 3600.0;

      for (let y = dc.yctr - dc.radius - skyResolution; y <= dc.yctr + dc.radius + skyResolution; y += skyResolution) {
        for (let x = dc.xctr - dc.radius - skyResolution; x <= dc.xctr + dc.radius + skyResolution; x += skyResolution) {
          const pos = SkyMap.screenXYToHorizontal(x, y, dc);
          const skyAlt = pos.altitude.degrees;

          if (skyAlt >= minAlt2) {
            dc.context.fillStyle = getSkyColor(sunPos, pos, totality);
            dc.context.fillRect(x - floor(skyResolution / 2), y - floor(skyResolution / 2), skyResolution + 1, skyResolution + 1);
          }
        }
      }
    }
    else {
      dc.context.beginPath();
      dc.context.fillStyle = skyColor;
      dc.context.arc(dc.xctr, dc.yctr, dc.radius / 0.95, 0, TWO_PI);
      dc.context.fill();
    }
  }

  private static cleanUpEdges(dc: DrawingContext): void {
    dc.context.beginPath();
    dc.context.globalCompositeOperation = 'destination-in';
    dc.context.fillStyle = 'black';
    dc.context.arc(dc.xctr, dc.yctr, dc.radius, 0, TWO_PI);
    dc.context.fill();
    dc.context.globalCompositeOperation = 'source-over';
  }

  private drawStars(dc: DrawingContext): void {
    for (let i = this.firstMag5; i < this.starCatalog.getStarCount(); ++i) {
      if (this.starCatalog.isDeepSkyObject(i))
        continue;

      const star = this.starCatalog.getStarInfo(i);
      const pos = this.starCatalog.getHorizontalPosition(i, dc.jdu, dc.skyObserver, 365.25, REFRACTION);
      const pt = SkyMap.sphericalToScreenXY(pos, dc);

      if (pt)
        SkyMap.drawStar(pt.x, pt.y, star.vmag, dc);
    }
  }

  private static drawStar(x: number, y: number, vmag: number, dc: DrawingContext, colorForPlanetDrawnAsStar?: string): void {
    const maxRange = (colorForPlanetDrawnAsStar ? 2000 - dc.starDimmestLevel - 1 : dc.starLevelRange);
    const brightness = min(max(dc.starLevelRange - round((vmag + 1.0) / 7.0 *
          dc.starLevelRange * 1.2), 0), maxRange) + dc.starDimmestLevel;
    const radius = brightness / 500;

    if (radius < 0.564 && !colorForPlanetDrawnAsStar) { // 0.564 is the radius of circle with an area of 1.
      const shade = round(radius * 452.13); // 0->0.564 transformed to a 0-255 range.

      dc.context.fillStyle = opacitiesOfWhite[shade];
      dc.context.fillRect(x, y, 1, 1);
    }
    else {
      dc.context.beginPath();
      dc.context.arc(x + 0.5, y + 0.5, min(radius, 2), 0, TWO_PI);
      dc.context.fillStyle = colorForPlanetDrawnAsStar || 'white';
      dc.context.fill();
    }
  }

  private drawPlanets(dc: DrawingContext): void {
    let planets: SortablePlanet[] = [];

    planetsToDraw.forEach(p => {
      planets.push({ planet: p, pos: this.getSphericalPosition(p, dc) as SphericalPosition3D });
    });

    planets = planets.sort((a, b) => b.pos.radius - a.pos.radius);

    for (const planet of planets) {
      const p = planet.planet;
      const pt = SkyMap.sphericalToScreenXY(planet.pos, dc);

      if (pt)
        this.drawPlanet(p, pt, dc);

      // if (pt || p === this.specialLabelIndex)
      //   this.qualifyBodyForSelection(pt, SELECTION_TYPE.PLANET, p, Boolean(pt), dc);
    }
  }

  private drawPlanet(planet: number, pt: Point, dc: DrawingContext): void {
    const label = {
      bodyIndex: planet,
      name: this.solarSystem.getPlanetName(planet),
      offsetX: LABEL_X_OFFSET,
      pt,
    };
    const { x, y } = pt;
    let size = 3;
    let color = planetColors[planet];

    SkyMap.addLabel(label, dc);

    if (planet === SUN || planet === MOON) {
      if (dc.pixelsPerArcSec > 0.0) {
        size = round(this.solarSystem.getAngularDiameter(planet, dc.jde) * dc.pixelsPerArcSec);
        size += (size + 1) % 2;
      }

      if (size < 6)
        size = 6;

      label.offsetX += max(0, size - LABEL_X_OFFSET);
    }

    let r0 = floor(size / 2);

    if (planet === MOON) {
      const phase = this.solarSystem.getLunarPhase(dc.jde);
      let coverage = (cos_deg(phase) + 1.0) / 2.0;
      const shadeAngle = this.getMoonShadingOrientation(dc);

      if (abs(mod2(phase, 360)) < 20.0)
        color = SHADED_MOON;
      else {
        color = ILLUMINATED_MOON;

        if (abs(phase - 180.0) < 3.0) {
          const ei = this.solarSystem.getLunarEclipseInfo(dc.jde);

          if (ei.inUmbra)
            color = blendColors(ECLIPSED_MOON, color, ei.totality);
        }

        if (abs(phase - 180.0) < 20.0)
          coverage = -1;
      }

      dc.context.save();
      dc.context.translate(x, y);
      dc.context.rotate(to_radian(shadeAngle));
      dc.context.fillStyle = color;
      fillCircle(dc.context, 0, 0, r0);

      if (coverage > 0) {
        r0 *= 1.01;
        dc.context.beginPath();
        dc.context.fillStyle = SHADED_MOON;
        dc.context.ellipse(0, 0, r0, r0, 0, PI / 2, PI * 3 / 2, phase > 180);
        dc.context.ellipse(0, 0, r0 * abs(1 - coverage * 2), r0, 0, PI * 3 / 2, PI * 5 / 2, !!(floor(phase / 90) % 2));
        dc.context.fill();
      }

      dc.context.restore();
    }
    else {
      // If scaled drawing is being done, draw potentially bright planets as stars before drawing them in the
      // usual rectangle/circle form, just in case the star form would be larger, so that a bright planet
      // doesn't get lost by size comparison amid otherwise larger/brighter looking stars.
      if (dc.pixelsPerArcSec > 0.0 && planet === VENUS) {
        const vmag = this.solarSystem.getMagnitude(planet, dc.jde);

        SkyMap.drawStar(pt.x, pt.y, vmag, dc, color);
      }

      dc.context.fillStyle = color;

      if (size <= 3)
        dc.context.fillRect(x - r0, y - r0, size, size);
      else {
        dc.context.beginPath();
        dc.context.arc(x + 0.5, y + 0.5, r0, 0, TWO_PI);
        dc.context.fill();
      }
    }
  }

  private drawConstellations(dc: DrawingContext): void {
    if (!this.appService.showConstellations)
      return;

    this.starCatalog.forEachConstellation(cInfo => {
      const starList = cInfo.starList;
      let breakLine = true;
      let minX = Number.MAX_SAFE_INTEGER, minY = Number.MAX_SAFE_INTEGER;
      let maxX = Number.MIN_SAFE_INTEGER, maxY = Number.MIN_SAFE_INTEGER;
      let hasAnchor = false;
      let nextIsAnchor = false;
      let lastPt = null;

      dc.context.strokeStyle = CONSTELLATION_LINE_COLOR;
      dc.context.lineWidth = 1;

      for (const starIndex of starList) {
        if (starIndex === LINE_BREAK) {
          breakLine = true;
          continue;
        }
        else if (starIndex === LABEL_ANCHOR) {
          nextIsAnchor = true;
          continue;
        }

        const pt = SkyMap.sphericalToScreenXY(this.getSphericalPosition(-starIndex - 1, dc), dc, true);

        if (!pt)
          break;

        if (!breakLine)
          SkyMap.strokeLine(pt, lastPt, dc);

        if (nextIsAnchor) {
          minX = maxX = pt.x;
          minY = maxY = pt.y;
          nextIsAnchor = false;
          hasAnchor = true;
        }
        else if (!hasAnchor) {
          minX = min(minX, pt.x);
          maxX = max(maxX, pt.x);
          minY = min(minY, pt.y);
          maxY = max(maxY, pt.y);
        }

        lastPt = pt;
        breakLine = false;
      }
    });
  }

  private static drawLabels(dc: DrawingContext): void {
    SkyMap.adjustLabelsToAvoidOverlap(dc);

    for (const li of dc.labels)
      SkyMap.drawLabel(li, dc);
  }

  private static drawLabel(li: LabelInfo, dc: DrawingContext): void {
    dc.context.fillStyle = 'black';
    dc.context.strokeStyle = 'black';

    if (dc.heavyLabels) { // Make labels clearer against a possibly bright background.
      dc.context.save();
      dc.context.lineWidth = 4;

      if (li.labelBounds) {
        dc.context.rect(li.labelBounds.x - 1, li.labelBounds.y - 1, li.labelBounds.w + 2, li.labelBounds.h + 2);
        dc.context.clip();
      }

      dc.context.lineJoin = 'round';
      dc.context.strokeText(li.name, li.textPt.x, li.textPt.y);
      dc.context.restore();
    }
    else
      dc.context.fillText(li.name, li.textPt.x + 1, li.textPt.y + 1); // Simple drop shadow.

    dc.context.fillStyle = planetColors[li.bodyIndex];
    dc.context.fillText(li.name, li.textPt.x, li.textPt.y);
  }

  private static strokeLine(pt1: Point, pt2: Point, dc: DrawingContext): void {
    const r1 = sqrt((pt1.x - dc.xctr) ** 2 + (pt1.y - dc.yctr) ** 2);
    const r2 = pt2 ? sqrt((pt2.x - dc.xctr) ** 2 + (pt2.y - dc.yctr) ** 2) : 0;
    const r = dc.radius + 5;

    if (r1 > r && r2 > r)
      return;
    else if (r1 > r)
      pt1 = { x: dc.xctr + (pt1.x - dc.xctr) * r / r1, y: dc.yctr + (pt1.y - dc.yctr) * r / r1 };
    else if (r2 > r)
      pt2 = { x: dc.xctr + (pt2.x - dc.xctr) * r / r2, y: dc.yctr + (pt2.y - dc.yctr) * r / r2 };

    strokeLine(dc.context, pt1.x, pt1.y, pt2?.x, pt2?.y);
  }

  private static sphericalToScreenXY(pos: SphericalPosition, dc: DrawingContext, forConstellation = false): Point {
    return pos && SkyMap.horizontalToScreenXY(pos.altitude.degrees, pos.azimuth.degrees, dc, forConstellation);
  }

  private static horizontalToScreenXY(alt: number, az: number, dc: DrawingContext, forConstellation = false): Point {
    if (alt >= -AVG_SUN_MOON_RADIUS || forConstellation && alt >= -75) {
      const r = (90.0 - alt) * dc.size / 180.0 * 0.995;
      const x = dc.xctr + cos_deg(-az + dc.facing + 90.0) * r;
      const y = dc.yctr + sin_deg(-az + dc.facing + 90.0) * r;

      return { x, y };
    }

    return null;
  }

  private static screenXYToHorizontal(x: number, y: number, dc: DrawingContext): SphericalPosition {
    const dx = x - dc.xctr;
    const dy = y - dc.yctr;
    const r = sqrt(dx * dx + dy * dy);
    const az = mod(90.0 - atan2_deg(dy, dx) + dc.facing, 360.0);
    const alt = 90.0 - r / dc.size * 180.0;

    return new SphericalPosition(az, alt, Unit.DEGREES, Unit.DEGREES);
  }

  private getMoonShadingOrientation(dc: DrawingContext): number {
    let dt = 0.0;
    let moonPara: Angle;

    // In the very unlikely event that the moon is precisely at the zenith, which makes the
    // parallactic angle calculation fail, we'll just move on to a slightly later moment in
    // time to fix the problem.
    //
    while (!(moonPara = this.solarSystem.getParallacticAngle(MOON, dc.jdu + dt, dc.skyObserver)))
      dt += 1.0E-5;

    const eclipticPos = this.solarSystem.getEclipticPosition(MOON, dc.jde + dt, dc.skyObserver);
    const obliquity = this.ecliptic.getNutation(dc.jde + dt).ε;
    const horizontalPos = this.getSphericalPosition(MOON, dc);

    moonPara = moonPara.add(obliquity.multiply(eclipticPos.longitude.cos));

    let angle = moonPara.degrees;
    const az = horizontalPos.azimuth.degrees;

    angle += dc.facing - az;

    return angle;
  }

  private getSphericalPosition(bodyIndex: number, dc: DrawingContext): SphericalPosition {
    if (bodyIndex < 0)
      return this.starCatalog.getHorizontalPosition(-bodyIndex - 1, dc.jdu, dc.skyObserver, 365.25, REFRACTION);

    let flags = dc.planetFlags;

    if (bodyIndex === MOON)
      flags |= TOPOCENTRIC;

    return this.solarSystem.getHorizontalPosition(bodyIndex, dc.jdu, dc.skyObserver, flags);
  }

  private static addLabel(li: LabelInfo, dc: DrawingContext): void {
    const textWidth = getTextWidth(li.name, labelFont);

    li.textPt = { x: li.pt.x + li.offsetX, y: li.pt.y + LABEL_Y_OFFSET };
    li.labelBounds = { x: li.textPt.x, y: li.textPt.y - labelMetrics.ascent, w: textWidth, h: labelMetrics.lineHeight };

    dc.labels.push(li);
  }

  private static adjustLabelsToAvoidOverlap(dc: DrawingContext): void {
    for (const li of dc.labels) {
      let delta = SkyMap.checkForOverlap(li, -1, false, dc);

      if (delta !== 0) {
        li.labelBounds.y += delta;
        li.textPt.y += delta;

        if (SkyMap.checkForOverlap(li, -1, false, dc) !== 0) {
          li.labelBounds.y -= delta;
          li.textPt.y -= delta;
          delta = SkyMap.checkForOverlap(li, 1, false, dc);
          li.labelBounds.y += delta;
          li.textPt.y += delta;

          if (SkyMap.checkForOverlap(li, 1, true, dc) !== 0) {
            li.labelBounds.y -= delta;
            li.textPt.y -= delta;
          }
        }
      }
    }
  }

  private static checkForOverlap(li: LabelInfo, bias: number, markOverlaps: boolean, dc: DrawingContext): number {
    for (const li2 of dc.labels) {
      if (li !== li2 && intersects(li.labelBounds, li2.labelBounds)) {
        const r = li2.labelBounds;
        const h = li.labelBounds.h;

        if (markOverlaps) {
          li.overlapped = true;
          li2.overlapped = true;
        }

        if ((bias <= 0 && li.pt.y < li2.pt.y) || (bias > 0 && li.pt.y >= li2.pt.y))
          return max(r.y - li.labelBounds.y - h, -h);
        else
          return min(r.y + r.h - li.labelBounds.y, h);
      }
    }

    return 0;
  }
}
