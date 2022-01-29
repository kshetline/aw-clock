import { AppService } from './app.service';
import {
  AsteroidCometInfo, AVG_SUN_MOON_RADIUS, Ecliptic, getSkyColor, ISkyObserver, JUPITER, LABEL_ANCHOR, LINE_BREAK, MARS, MERCURY,
  MOON, NUTATION, REFRACTION, SATURN, SkyObserver, SolarSystem, StarCatalog, SUN, TOPOCENTRIC, VENUS
} from '@tubular/astronomy';
import { getBinary } from './awc-util';
import ttime from '@tubular/time';
import julianDay = ttime.julianDay;
import {
  abs, Angle, atan2_deg, cos_deg, floor, max, min, mod, mod2, Point, pow, round, sin_deg, SphericalPosition,
  SphericalPosition3D, sqrt, TWO_PI, Unit
} from '@tubular/math';
import { colorFromRGB, strokeLine } from '@tubular/util';

interface DrawingContext {
  context: CanvasRenderingContext2D;
  radius: number;
  size: number;
  xctr: number;
  yctr: number;
  pixelsPerArcSec: number;
  planetFlags?: number;
  minStarBrightness?: number;
  scaleBoost?: number;
  starBrightestLevel?: number;
  starDimmestLevel?: number;
  starLevelRange?: number;
  skyObserver: ISkyObserver;
  jdu: number;
  jde: number;
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
  'yellow',  '#C0C0C0', '#EEEEFF', // Sun, Mercury, Venus
  '#00CCCC', 'red',     'orange',  // Earth, Mars, Jupiter
  'yellow', '', '', '', '#EEEEFF'  // Saturn, Moon
];

// These color specifications are left incomplete so that the alpha value can be varied.
const SHADED_MOON            = 'rgba(102,153,204,';
const INTERMEDIATE_MOON      = 'rgba(178,204,229,';
const ILLUMINATED_MOON       = 'rgba(255,255,255,';

const CONSTELLATION_LINE_COLOR = '#0000FF';

const planetsToDraw = [SUN, MERCURY, VENUS, MARS, JUPITER, SATURN];

export class SkyMap {
  private static starData: ArrayBuffer;
  private static starDataPromise: Promise<ArrayBuffer>;

  private ecliptic = new Ecliptic();
  private facing = 0;
  private firstMag5 = 0;
  private minAlt = -0.00833;
  private multiColor = true;
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

  draw(canvas: HTMLCanvasElement, longitude: number, latitude: number): void {
    if (!this.starCatalog)
      return;
    else if (this.firstMag5 === 0) {
      setTimeout(() => this.draw(canvas, longitude, latitude), 100);
      return;
    }

    const jdu = julianDay(this.appService.getCurrentTime());
    const width = parseFloat(canvas.style.width);
    const height = parseFloat(canvas.style.height);
    const radius = floor(min(width, height) / 2 * 0.95);
    const canvasScaling = canvas.width / width;
    const dc = {
      context: canvas.getContext('2d'),
      radius,
      size: radius * 2,
      pixelsPerArcSec: radius * 0.95 / 90.0 / 3600.0,
      xctr: round(width / 2),
      yctr: round(height / 2),
      skyObserver: new SkyObserver(longitude, latitude),
      jdu,
      jde: ttime.utToTdt(jdu),
      planetFlags: NUTATION | REFRACTION
    } as DrawingContext;

    dc.scaleBoost = pow(dc.pixelsPerArcSec * 1.5 / SCALE_WHERE_BRIGHTEST_STAR_IS_3x3, 0.521);
    dc.starBrightestLevel = min(round(dc.scaleBoost * BRIGHTEST_3x3_STAR_IMAGE_INDEX), 1999);
    dc.starDimmestLevel = min(max(min(round(dc.scaleBoost * DIMMEST_AT_SCALE_1x1_STAR_IMAGE_INDEX), 1999),
                              DIMMEST_ALLOWED_1x1_STAR_IMAGE_INDEX), BRIGHTEST_1x1_STAR_IMAGE_INDEX);
    dc.starLevelRange = dc.starBrightestLevel - dc.starDimmestLevel;

    dc.context.setTransform(canvasScaling, 0, 0, canvasScaling, 0, 0);
    this.drawSky(dc);
    this.drawConstellations(dc);
    this.drawStars(dc);
    this.drawPlanets(dc);
    this.drawEdgeFix(dc);
  }

  private drawSky(dc: DrawingContext): void {
    const sunPos = this.solarSystem.getHorizontalPosition(SUN, dc.jdu, dc.skyObserver, dc.planetFlags);
    const alt = sunPos.altitude.degrees;
    const totality = this.solarSystem.getLocalSolarEclipseTotality(dc.jde, dc.skyObserver);
    let skyColor: string;

    if (alt < -18)
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

    if (this.multiColor && alt >= -18) {
      const skyResolution = DEFAULT_SKY_RESOLUTION;

      // dc.heavyLabels = true;

      const minAlt2 = this.minAlt - skyResolution / dc.pixelsPerArcSec / 3600.0;

      for (let y = dc.yctr - dc.radius - skyResolution; y <= dc.yctr + dc.radius + skyResolution; y += skyResolution) {
        for (let x = dc.xctr - dc.radius - skyResolution; x <= dc.xctr + dc.radius + skyResolution; x += skyResolution) {
          const pos = this.screenXYToHorizontal(x, y, dc);
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

  private drawEdgeFix(dc: DrawingContext): void {
    dc.context.beginPath();
    dc.context.strokeStyle = this.appService.settings.clockFace;
    dc.context.lineWidth = dc.radius * 0.055;
    dc.context.arc(dc.xctr, dc.yctr, dc.radius / 0.975, 0, TWO_PI);
    dc.context.stroke();
  }

  private drawStars(dc: DrawingContext): void {
    for (let i = this.firstMag5; i < this.starCatalog.getStarCount(); ++i) {
      if (this.starCatalog.isDeepSkyObject(i))
        continue;

      const star = this.starCatalog.getStarInfo(i);
      const pos = this.starCatalog.getHorizontalPosition(i, dc.jdu, dc.skyObserver, 365.25, REFRACTION);
      const pt = this.sphericalToScreenXY(pos, dc);

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
      const pt = this.sphericalToScreenXY(planet.pos, dc);

      if (pt)
        this.drawPlanet(p, pt, dc);

      // if (pt || p === this.specialLabelIndex)
      //   this.qualifyBodyForSelection(pt, SELECTION_TYPE.PLANET, p, Boolean(pt), dc);
    }
  }

  private drawPlanet(planet: number, pt: Point, dc: DrawingContext): void {
    const { x, y } = pt;
    let size = 3;
    let color = planetColors[planet];

    if (planet === SUN || planet === MOON) {
      if (dc.pixelsPerArcSec > 0.0) {
        size = round(this.solarSystem.getAngularDiameter(planet, dc.jde) * dc.pixelsPerArcSec);
        size += (size + 1) % 2;
      }

      if (size < 6)
        size = 6;
    }

    const r0 = floor(size / 2);

    if (planet === MOON) {
      const phase = this.solarSystem.getLunarPhase(dc.jde);
      const coverage = (cos_deg(phase) + 1.0) / 2.0;
      const shadeAngle = this.getMoonShadingOrientation(dc);
      const sin_sa = sin_deg(shadeAngle);
      const cos_sa = cos_deg(shadeAngle);
      const r02 = r0 * r0;

      for (let dy = -r0 - 1; dy <= r0 + 1; ++dy) {
        for (let dx = -r0 - 1; dx <= r0 + 1; ++dx) {
          const rot_x = dx * cos_sa + dy * sin_sa;
          const rot_y = dy * cos_sa - dx * sin_sa;
          const r = sqrt(rot_x * rot_x + rot_y * rot_y);

          if (r <= r0 + 1) {
            let alpha = 1.0;

            if (r > r0)
              alpha = 1.0 - r + r0;

            if (abs(mod2(phase, 360)) < 20.0) {
              color = SHADED_MOON;
            }
            else if (abs(phase - 180.0) < 20.0)
              color = ILLUMINATED_MOON;
            else {
              const lineWidth = 2 * sqrt(max(r02 - rot_y * rot_y, 0.0)) + 1.0;
              const inset = rot_x + (lineWidth - 1.0) / 2;
              const shadowWidth = coverage * lineWidth;
              let leftSpan: number;

              if (phase <= 180.0)
                leftSpan = shadowWidth - 0.5;
              else
                leftSpan = lineWidth - shadowWidth - 0.5;

              if ((phase <= 180.0 && inset < leftSpan + 0.25) ||
                  (phase  > 180.0 && inset > leftSpan + 0.25))
                color = SHADED_MOON;
              else if (abs(inset - leftSpan) <= 0.5) {
                color = INTERMEDIATE_MOON;
              }
              else
                color = ILLUMINATED_MOON;
            }

            dc.context.fillStyle = color + alpha + ')';
            dc.context.fillRect(x + dx, y + dy, 1, 1);
          }
        }
      }
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
    this.starCatalog.forEachConstellation(cInfo => {
      const starList = cInfo.starList;
      let starCount = 0;
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

        const pt = this.sphericalToScreenXY(this.getSphericalPosition(-starIndex - 1, dc), dc, true);

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

        ++starCount;
        lastPt = pt;
        breakLine = false;
      }
    });
  }

  private static strokeLine(pt1: Point, pt2: Point, dc: DrawingContext): void {
    const r1 = sqrt((pt1.x - dc.xctr) ** 2 + (pt1.y - dc.yctr) ** 2);
    const r2 = pt2 ? sqrt((pt2.x - dc.xctr) ** 2 + (pt2.y - dc.yctr) ** 2) : 0;
    const r = dc.radius + 3;

    if (r1 > r && r2 > r)
      return;
    else if (r1 > r)
      pt1 = { x: dc.xctr + (pt1.x - dc.xctr) * r / r1, y: dc.yctr + (pt1.y - dc.yctr) * r / r1 };
    else if (r2 > r)
      pt2 = { x: dc.xctr + (pt2.x - dc.xctr) * r / r2, y: dc.yctr + (pt2.y - dc.yctr) * r / r2 };

    strokeLine(dc.context, pt1.x, pt1.y, pt2?.x, pt2?.y);
  }

  private sphericalToScreenXY(pos: SphericalPosition, dc: DrawingContext, forConstellation = false): Point {
    return pos && this.horizontalToScreenXY(pos.altitude.degrees, pos.azimuth.degrees, dc, forConstellation);
  }

  private horizontalToScreenXY(alt: number, az: number, dc: DrawingContext, forConstellation = false): Point {
    if (alt >= -AVG_SUN_MOON_RADIUS || forConstellation && alt >= -75) {
      const r = (90.0 - alt) * dc.size / 180.0 * 0.995;
      const x = dc.xctr + cos_deg(-az + this.facing + 90.0) * r;
      const y = dc.yctr + sin_deg(-az + this.facing + 90.0) * r;

      return { x, y };
    }

    return null;
  }

  private screenXYToHorizontal(x: number, y: number, dc: DrawingContext): SphericalPosition {
    const dx = x - dc.xctr;
    const dy = y - dc.yctr;
    const r = sqrt(dx * dx + dy * dy);
    const az = mod(90.0 - atan2_deg(dy, dx) + this.facing, 360.0);
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

    angle += this.facing - az;

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
}
