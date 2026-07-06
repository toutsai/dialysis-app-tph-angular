// src/app/features/login/login.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@app/core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  username = signal('');
  password = signal('');
  errorMessage = signal('');
  isLoading = signal(false);
  isPasswordVisible = signal(false);
  /** 被登出原因提示（由上一頁帶 ?reason= 進來） */
  noticeMessage = signal('');

  constructor() {
    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason) this.noticeMessage.set(this.reasonToMessage(reason));
  }

  private reasonToMessage(reason: string): string {
    switch (reason) {
      case 'idle':
        return '因閒置逾時，系統已自動將您登出，請重新登入。';
      case 'another_device':
        return '您的帳號已在其他裝置登入，此處連線已被登出。若非本人操作請通知管理員。';
      case 'expired':
        return '登入已逾期，請重新登入。';
      default:
        return '';
    }
  }

  togglePasswordVisibility(): void {
    this.isPasswordVisible.update((v) => !v);
  }

  async handleLogin(): Promise<void> {
    if (this.isLoading()) return;

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const result = await this.authService.login(
        this.username(),
        this.password(),
      );
      if (result.success) {
        // 登入成功後導回原本要去的頁面（守衛帶入的 ?returnUrl=），否則回首頁。
        // 只接受站內路徑（以 / 開頭、非 //），避免 open redirect。
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const isSafeInternalPath =
          !!returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//');
        this.router.navigateByUrl(isSafeInternalPath ? returnUrl : '/');
      } else {
        this.errorMessage.set(result.error || '登入發生錯誤');
        this.isLoading.set(false);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '登入發生錯誤';
      this.errorMessage.set(message);
      this.isLoading.set(false);
    }
  }

  onUsernameInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.username.set(target.value);
  }

  onPasswordInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.password.set(target.value);
  }
}
