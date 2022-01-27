import { AppService } from './app.service';
import { AsteroidCometInfo, ISkyObserver, REFRACTION, SkyObserver, StarCatalog } from '@tubular/astronomy';
import { getBinary } from './awc-util';
import ttime from '@tubular/time';
import julianDay = ttime.julianDay;
import { cos_deg, floor, max, min, pow, round, sin_deg, TWO_PI } from '@tubular/math';

interface DrawingContext {
  context: CanvasRenderingContext2D;
  radius: number;
  size: number;
  xctr: number;
  yctr: number;
  pixelsPerArcSec: number;
  scaleBoost: number;
  starBrightestLevel: number;
  starDimmestLevel: number;
  starLevelRange: number;
  maxStarRadius: number;
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

export class SkyMap {
  private static starData: ArrayBuffer;
  private static starDataPromise: Promise<ArrayBuffer>;

  private facing = 0;
  private firstMag5 = 0;
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
    const radius = floor(min(canvas.width, canvas.height) / 2 * 0.95);
    const dc = {
      context: canvas.getContext('2d'),
      radius,
      size: radius * 2,
      pixelsPerArcSec: radius / 90.0 / 3600.0,
      xctr: round(canvas.width / 2),
      yctr: round(canvas.height / 2),
      maxStarRadius: 2 * (window.devicePixelRatio || 1),
      skyObserver: new SkyObserver(longitude, latitude),
      jdu,
      jde: ttime.utToTdt(jdu)
    } as unknown as DrawingContext;

    dc.scaleBoost = pow(dc.pixelsPerArcSec / SCALE_WHERE_BRIGHTEST_STAR_IS_3x3, 0.521);
    dc.starBrightestLevel = min(round(dc.scaleBoost * BRIGHTEST_3x3_STAR_IMAGE_INDEX), 1999);
    dc.starDimmestLevel = min(max(min(round(dc.scaleBoost * DIMMEST_AT_SCALE_1x1_STAR_IMAGE_INDEX), 1999),
                              DIMMEST_ALLOWED_1x1_STAR_IMAGE_INDEX), BRIGHTEST_1x1_STAR_IMAGE_INDEX);
    dc.starLevelRange = dc.starBrightestLevel - dc.starDimmestLevel;

    this.drawSky(dc);
    this.drawStars(dc);
  }

  private drawSky(dc: DrawingContext): void {
    dc.context.fillStyle = 'black';
    dc.context.arc(dc.xctr, dc.yctr, dc.radius, 0, TWO_PI);
    dc.context.fill();
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
    const radius = brightness / 360;

    if (radius < 0.564 && !colorForPlanetDrawnAsStar) { // 0.564 is the radius of circle with an area of 1.
      const shade = round(radius * 452.13); // 0->0.564 transformed to a 0-255 range.

      dc.context.fillStyle = opacitiesOfWhite[shade];
      dc.context.fillRect(x, y, 1, 1);
    }
    else {
      dc.context.beginPath();
      dc.context.arc(x + 0.5, y + 0.5, min(radius, dc.maxStarRadius), 0, TWO_PI);
      dc.context.fillStyle = colorForPlanetDrawnAsStar || 'white';
      dc.context.fill();
    }
  }
}
