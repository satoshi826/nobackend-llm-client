// Buttons that are off while the open conversation is being answered. Only the button follows that: a message
// drawing one is not drawn again when an answer starts or ends (a long conversation has hundreds of them)
import type { ComponentProps } from 'preact';
import { isStreaming } from '../state/runs';
import { Button, IconButton } from './ui';

export function IdleButton({ disabled, ...rest }: ComponentProps<typeof Button>) {
  return <Button {...rest} disabled={disabled || isStreaming.value} />;
}

export function IdleIconButton({ disabled, ...rest }: ComponentProps<typeof IconButton>) {
  return <IconButton {...rest} disabled={disabled || isStreaming.value} />;
}
