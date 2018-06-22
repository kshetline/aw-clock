import { browser } from 'protractor';
import { AppPage } from './app.po';

browser.waitForAngularEnabled(false);

describe('aw-clock', () => {
  let page: AppPage;

  beforeEach(() => {
    page = new AppPage();
  });

  it('should display time', () => {
    page.navigateTo();
    browser.sleep(2000);
    expect(page.getTimeText()).toMatch(/\d\d:\d\d.*/);
  });
});
