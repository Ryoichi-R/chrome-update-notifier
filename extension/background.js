import { installNotifier } from './notifier.mjs';

installNotifier({
    chrome,
    fetchFn: (url, init) => fetch(url, init),
    nav: navigator,
});
