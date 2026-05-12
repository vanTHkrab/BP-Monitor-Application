import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { CurrentUserContext } from './types/auth.types';

export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): CurrentUserContext | undefined => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext<{ user?: CurrentUserContext }>().user;
  },
);
