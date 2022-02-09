import { Request, Response, Router } from 'express';
import { requestText } from 'by-request';
import { HtmlParser } from 'fortissimo-html';
import { AWC_VERSION } from './shared-types';
import { noCache } from './awcs-util';

export const router = Router();

router.get('/', async (req: Request, res: Response) => {
  noCache(res);

  const options = { headers: { 'User-Agent': 'Astronomy/Weather Clock ' + AWC_VERSION } };

  try {
    const bodyHtml = await requestText('https://github.com/kshetline/aw-clock/blob/master/CHANGELOG.md', options);
    const parsed = new HtmlParser().parse(bodyHtml);
    const infoHtml = parsed.domRoot.querySelector('article.markdown-body');

    infoHtml.querySelectorAll('svg').forEach(node => node.parent.remove());
    infoHtml.querySelectorAll('h2').forEach(node => node.deleteAttribute('dir'));
    infoHtml.querySelectorAll('ul').forEach(node => node.deleteAttribute('dir'));

    // "Denature" links in release notes.
    infoHtml.querySelectorAll('a').forEach(link => {
      link.tag = 'span';
      link.clearAttributes();
      link.addAttribute('class', 'ex-link');
    });

    res.send(infoHtml.toString(false));
  }
  catch (err) {
    res.status(500).send(err.toString());
  }
});
