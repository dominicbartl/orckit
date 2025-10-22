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
    <div class="dashboard">
      <header>
        <h1>Admin Dashboard</h1>
        <p>Full-Stack SaaS Application - Orchestrated by Orckit</p>
      </header>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats?.totalUsers || 0 }}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats?.activeUsers || 0 }}</div>
          <div class="stat-label">Active Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${{ stats?.totalRevenue?.toFixed(2) || 0 }}</div>
          <div class="stat-label">Total Revenue</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats?.newSignups || 0 }}</div>
          <div class="stat-label">New Signups</div>
        </div>
      </div>

      <div class="users-section">
        <h2>Users</h2>
        <div class="users-list">
          <div class="user-card" *ngFor="let user of users">
            <div class="user-name">{{ user.name }}</div>
            <div class="user-role" [class.admin]="user.role === 'admin'">
              {{ user.role }}
            </div>
          </div>
        </div>
      </div>

      <div class="status">
        <div class="status-indicator" [class.connected]="isConnected"></div>
        <span>{{ isConnected ? 'Connected to API' : 'Connecting...' }}</span>
      </div>
    </div>
  `,
  styles: [`
    .dashboard {
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

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .stat-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
    }

    .stat-value {
      font-size: 36px;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 10px;
    }

    .stat-label {
      font-size: 14px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .users-section {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
    }

    .users-section h2 {
      margin-bottom: 20px;
      color: #333;
    }

    .users-list {
      display: grid;
      gap: 15px;
    }

    .user-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .user-name {
      font-weight: 500;
      color: #333;
    }

    .user-role {
      padding: 4px 12px;
      background: #e0e7ff;
      color: #667eea;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .user-role.admin {
      background: #fef3c7;
      color: #d97706;
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
  users: User[] = [];
  stats: Stats | null = null;
  isConnected = false;

  private apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadData();
    // Refresh data every 30 seconds
    setInterval(() => this.loadData(), 30000);
  }

  loadData() {
    this.http.get<{ data: User[] }>(`${this.apiUrl}/users`).subscribe({
      next: (response) => {
        this.users = response.data;
        this.isConnected = true;
      },
      error: (err) => {
        console.error('Error loading users:', err);
        this.isConnected = false;
      }
    });

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
