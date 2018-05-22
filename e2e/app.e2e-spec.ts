import { browser } from 'protractor';
import { AppPage } from './app.po';

browser.waitForAngularEnabled(false);

describe('my-app App', () => {
  let page: AppPage;

  beforeEach(() => {
    page = new AppPage();
  });

  it('should display date', () => {
    page.navigateTo();
    expect(page.getDateText()).toMatch(/\w\w\w \d\d\d\d-\d\d-\d\d/);
  });
});
