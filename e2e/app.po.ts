import { browser, by, element } from 'protractor';

export class AppPage {
  navigateTo() {
    return browser.get('/');
  }

  getDateText() {
    return element(by.css('#date')).getText();
  }
}
