/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import App from './App';
import Dashboard from './pages/dashboard';
import Sink from './pages/sink';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Dashboard} />
      <Route path="/sink" component={Sink} />
    </Router>
  ),
  root,
);
