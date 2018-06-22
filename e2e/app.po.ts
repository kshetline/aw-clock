import { browser, by, element } from 'protractor';

export class AppPage {
  navigateTo() {
    return browser.get('/');
  }

  getTimeText() {
    return element(by.css('#time')).getText();
  }
}
