import { AppService } from './app.service';
import {
  AsteroidCometInfo,
  getSkyColor,
  ISkyObserver,
  NUTATION,
  REFRACTION,
  SkyObserver,
  SolarSystem,
  StarCatalog,
  SUN
} from '@tubular/astronomy';
import { getBinary } from './awc-util';
import ttime from '@tubular/time';
import julianDay = ttime.julianDay;
import { atan2_deg, cos_deg, floor, max, min, mod, pow, round, sin_deg, SphericalPosition, sqrt, TWO_PI, Unit } from '@tubular/math';
import { colorFromRGB } from '@tubular/util';

interface DrawingContext {
  context: CanvasRenderingContext2D;
  radius: number;
  size: number;
  xctr: number;
  yctr: number;
  pixelsPerArcSec: number;
  minStarBrightness?: number;
  scaleBoost?: number;
  starBrightestLevel?: number;
  starDimmestLevel?: number;
  starLevelRange?: number;
  skyObserver: ISkyObserver;
  jdu: number;
  jde: number;
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

export class SkyMap {
  private static starData: ArrayBuffer;
  private static starDataPromise: Promise<ArrayBuffer>;

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
      if (initialized)
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
      jde: ttime.utToTdt(jdu)
    } as DrawingContext;
    console.log(parseFloat(canvas.style.width), parseFloat(canvas.style.width) * 0.95, dc.pixelsPerArcSec);
    dc.scaleBoost = pow(dc.pixelsPerArcSec * 1.5 / SCALE_WHERE_BRIGHTEST_STAR_IS_3x3, 0.521);
    dc.starBrightestLevel = min(round(dc.scaleBoost * BRIGHTEST_3x3_STAR_IMAGE_INDEX), 1999);
    dc.starDimmestLevel = min(max(min(round(dc.scaleBoost * DIMMEST_AT_SCALE_1x1_STAR_IMAGE_INDEX), 1999),
                              DIMMEST_ALLOWED_1x1_STAR_IMAGE_INDEX), BRIGHTEST_1x1_STAR_IMAGE_INDEX);
    dc.starLevelRange = dc.starBrightestLevel - dc.starDimmestLevel;

    dc.context.setTransform(canvasScaling, 0, 0, canvasScaling, 0, 0);
    this.drawSky(dc);
    this.drawStars(dc);
  }

  private drawSky(dc: DrawingContext): void {
    const sunPos = this.solarSystem.getHorizontalPosition(SUN, dc.jdu, dc.skyObserver, NUTATION | REFRACTION);
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
      const alt = pos.altitude.degrees;

      if (alt >= 0) {
        const az = pos.azimuth.degrees;
        const r = (90.0 - alt) * dc.size / 180.0 * 0.995;
        const x = dc.xctr + cos_deg(-az + this.facing + 90.0) * r;
        const y = dc.yctr + sin_deg(-az + this.facing + 90.0) * r;

        this.drawStar(x, y, star.vmag, dc);
      }
    }
  }

  private drawStar(x: number, y: number, vmag: number, dc: DrawingContext, colorForPlanetDrawnAsStar?: string): void {
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

  private screenXYToHorizontal(x: number, y: number, dc: DrawingContext): SphericalPosition {
    const dx = x - dc.xctr;
    const dy = y - dc.yctr;
    const r = sqrt(dx * dx + dy * dy);
    const az = mod(90.0 - atan2_deg(dy, dx) + this.facing, 360.0);
    const alt = 90.0 - r / dc.size * 180.0;

    return new SphericalPosition(az, alt, Unit.DEGREES, Unit.DEGREES);
  }
}
