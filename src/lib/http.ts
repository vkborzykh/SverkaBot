import { NextResponse } from 'next/server';

export interface ApiOk<T = unknown> {
  success: true;
  data: T;
  error: null;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

export function okResponse<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function errResponse(
  code: string,
  message: string,
  status = 400,
): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  );
}
