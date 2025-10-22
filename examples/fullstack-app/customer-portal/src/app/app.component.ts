import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

interface User {
  id: number;
  name: string;
  role: string;
}

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  newSignups: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="portal">
      <header>
        <h1>Customer Portal</h1>
        <p>Welcome to Your Account Dashboard</p>
      </header>

      <div class="welcome-card">
        <h2>Hello, Customer!</h2>
        <p>Manage your account, view your activity, and explore our services.</p>
      </div>

      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">📊</div>
          <h3>Analytics</h3>
          <p>Track your usage and performance metrics in real-time.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Security</h3>
          <p>Manage your security settings and authentication methods.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">💳</div>
          <h3>Billing</h3>
          <p>View invoices, update payment methods, and manage subscriptions.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎯</div>
          <h3>Support</h3>
          <p>Get help from our support team and access documentation.</p>
        </div>
      </div>

      <div class="activity-section">
        <h2>Recent Activity</h2>
        <div class="activity-list">
          <div class="activity-item">
            <div class="activity-icon">✓</div>
            <div class="activity-content">
              <div class="activity-title">Account created successfully</div>
              <div class="activity-time">2 hours ago</div>
            </div>
          </div>
          <div class="activity-item">
            <div class="activity-icon">🔑</div>
            <div class="activity-content">
              <div class="activity-title">API key generated</div>
              <div class="activity-time">5 hours ago</div>
            </div>
          </div>
          <div class="activity-item">
            <div class="activity-icon">📧</div>
            <div class="activity-content">
              <div class="activity-title">Email verified</div>
              <div class="activity-time">1 day ago</div>
            </div>
          </div>
        </div>
      </div>

      <div class="stats-bar">
        <div class="stat-item">
          <div class="stat-label">Active Users</div>
          <div class="stat-value">{{ stats?.activeUsers || 0 }}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Total Users</div>
          <div class="stat-value">{{ stats?.totalUsers || 0 }}</div>
        </div>
      </div>

      <div class="status">
        <div class="status-indicator" [class.connected]="isConnected"></div>
        <span>{{ isConnected ? 'Connected to API' : 'Connecting...' }}</span>
      </div>
    </div>
  `,
  styles: [`
    .portal {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      color: white;
      margin-bottom: 40px;
    }

    header h1 {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 10px;
    }

    header p {
      font-size: 18px;
      opacity: 0.9;
    }

    .welcome-card {
      background: white;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      margin-bottom: 30px;
      text-align: center;
    }

    .welcome-card h2 {
      color: #333;
      margin-bottom: 15px;
      font-size: 32px;
    }

    .welcome-card p {
      color: #666;
      font-size: 16px;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .feature-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
      transition: transform 0.2s;
    }

    .feature-card:hover {
      transform: translateY(-5px);
    }

    .feature-icon {
      font-size: 48px;
      margin-bottom: 15px;
    }

    .feature-card h3 {
      color: #333;
      margin-bottom: 10px;
      font-size: 20px;
    }

    .feature-card p {
      color: #666;
      font-size: 14px;
      line-height: 1.6;
    }

    .activity-section {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      margin-bottom: 30px;
    }

    .activity-section h2 {
      margin-bottom: 20px;
      color: #333;
    }

    .activity-list {
      display: grid;
      gap: 15px;
    }

    .activity-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      align-items: center;
    }

    .activity-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #e0e7ff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }

    .activity-content {
      flex: 1;
    }

    .activity-title {
      font-weight: 500;
      color: #333;
      margin-bottom: 4px;
    }

    .activity-time {
      font-size: 12px;
      color: #999;
    }

    .stats-bar {
      display: flex;
      gap: 20px;
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
    }

    .stat-item {
      flex: 1;
      text-align: center;
    }

    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #667eea;
    }

    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: white;
      font-size: 14px;
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ef4444;
      animation: pulse 2s infinite;
    }

    .status-indicator.connected {
      background: #10b981;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
  `]
})
export class AppComponent implements OnInit {
  stats: Stats | null = null;
  isConnected = false;

  private apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadStats();
    // Refresh data every 30 seconds
    setInterval(() => this.loadStats(), 30000);
  }

  loadStats() {
    this.http.get<Stats>(`${this.apiUrl}/stats`).subscribe({
      next: (stats) => {
        this.stats = stats;
        this.isConnected = true;
      },
      error: (err) => {
        console.error('Error loading stats:', err);
        this.isConnected = false;
      }
    });
  }
}
