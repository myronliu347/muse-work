import React from "react";
import { Flex, Text } from "@radix-ui/themes";

export function Field(props: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1">
      <label htmlFor={props.htmlFor}>
        <Text size="2" weight="medium">
          {props.label}
        </Text>
      </label>
      {props.children}
      {props.error ? (
        <Text size="1" color="red">
          {props.error}
        </Text>
      ) : null}
      {props.hint && !props.error ? (
        <Text size="1" color="gray">
          {props.hint}
        </Text>
      ) : null}
    </Flex>
  );
}
